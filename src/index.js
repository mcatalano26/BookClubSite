export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    
    // Handle API endpoints
    if (url.pathname === '/api/book') {
      if (method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
          }
        });
      }
      if (method === 'POST') {
        return await this.handleBookUpdate(request, env);
      }
    }
    
    // Handle main page
    return await this.handleMainPage(request, env);
  },
  
  async handleBookUpdate(request, env) {
    try {
      console.log('Received book update request');
      
      const body = await request.json();
      const { title, author } = body;
      
      console.log('Parsed request body:', { title, author });
      
      if (!title || !author) {
        console.log('Missing title or author');
        return new Response(JSON.stringify({ error: 'Title and author are required' }), {
          status: 400,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
      
      // Store in KV
      const bookData = {
        title: title.trim(),
        author: author.trim(),
        updatedAt: new Date().toISOString()
      };
      
      console.log('Attempting to store in KV:', bookData);
      
      if (!env.BOOKCLUB_KV) {
        console.error('BOOKCLUB_KV namespace not available');
        return new Response(JSON.stringify({ error: 'Storage not available' }), {
          status: 500,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
      
      await env.BOOKCLUB_KV.put('current_book', JSON.stringify(bookData));
      console.log('Successfully stored book in KV');
      
      return new Response(JSON.stringify({ success: true, book: bookData }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    } catch (error) {
      console.error('Error in handleBookUpdate:', error);
      return new Response(JSON.stringify({ error: `Failed to update book: ${error.message}` }), {
        status: 500,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  },
  
  async handleMainPage(request, env) {
    const url = new URL(request.url);
    
    // Priority: KV storage > URL params > defaults
    let currentBook = { title: "Catch-22", author: "Joseph Heller" };
    
    try {
      // Try to get from KV first
      const storedBook = await env.BOOKCLUB_KV?.get('current_book');
      if (storedBook) {
        const parsed = JSON.parse(storedBook);
        currentBook = { title: parsed.title, author: parsed.author };
        console.log('Loaded book from KV:', currentBook);
      }
    } catch (error) {
      console.log('KV not available or failed, using fallback');
    }
    
    // URL params can still override (useful for testing)
    const urlTitle = url.searchParams.get('title');
    const urlAuthor = url.searchParams.get('author');
    if (urlTitle && urlAuthor) {
      currentBook = { title: urlTitle, author: urlAuthor };
      console.log('Using URL params:', currentBook);
    }

    // Function to get book cover URLs with multiple fallback sources
    const getCoverSources = (bookInfo) => {
      const sources = [];
      
      // 1. Google Books thumbnail (often highest quality and most available)
      if (bookInfo.thumbnail) {
        sources.push(bookInfo.thumbnail.replace('&zoom=1', '&zoom=0')); // Higher res
        sources.push(bookInfo.thumbnail);
      }
      
      // 2. Open Library by ISBN
      if (bookInfo.isbn) {
        sources.push(`https://covers.openlibrary.org/b/isbn/${bookInfo.isbn}-L.jpg`);
        sources.push(`https://covers.openlibrary.org/b/isbn/${bookInfo.isbn}-M.jpg`);
      }
      
      // 3. Try different ISBN formats if available
      if (bookInfo.alternateIsbns) {
        bookInfo.alternateIsbns.forEach(isbn => {
          sources.push(`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`);
        });
      }
      
      return sources;
    };

    // Function to fetch book details from Google Books API
    const fetchBookDetails = async () => {
      // For dynamic titles/authors, search by title + author first
      try {
        const titleApiUrl = `https://www.googleapis.com/books/v1/volumes?q=intitle:"${currentBook.title}"+inauthor:"${currentBook.author}"&maxResults=10`;
        console.log('Fetching book details:', titleApiUrl);
        
        const response = await fetch(titleApiUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log('Book search API Response:', data);
          
          if (data.items && data.items.length > 0) {
            // Find the best result with description and ISBN
            for (const item of data.items) {
              const bookInfo = item.volumeInfo;
              
              // Prefer results with descriptions and ISBN
              const hasDescription = bookInfo.description && bookInfo.description.length > 100;
              const hasIsbn = bookInfo.industryIdentifiers && bookInfo.industryIdentifiers.length > 0;
              
              if (hasDescription || hasIsbn) {
                let description = bookInfo.description || 'A compelling read selected for our literary society.';
                if (description.includes('<')) {
                  description = description.replace(/<[^>]*>/g, '');
                }
                
                // Get all available ISBNs for better cover lookup
                let isbn = null;
                let alternateIsbns = [];
                
                if (bookInfo.industryIdentifiers) {
                  const isbn13 = bookInfo.industryIdentifiers.find(id => id.type === 'ISBN_13');
                  const isbn10 = bookInfo.industryIdentifiers.find(id => id.type === 'ISBN_10');
                  isbn = isbn13?.identifier || isbn10?.identifier;
                  
                  // Collect all ISBNs for fallback attempts
                  alternateIsbns = bookInfo.industryIdentifiers
                    .filter(id => id.type.includes('ISBN'))
                    .map(id => id.identifier)
                    .filter(id => id !== isbn);
                }
                
                return {
                  title: bookInfo.title || currentBook.title,
                  author: bookInfo.authors ? bookInfo.authors.join(', ') : currentBook.author,
                  description: description,
                  isbn: isbn,
                  alternateIsbns: alternateIsbns,
                  publishedDate: bookInfo.publishedDate,
                  pageCount: bookInfo.pageCount,
                  categories: bookInfo.categories,
                  thumbnail: bookInfo.imageLinks?.thumbnail
                };
              }
            }
            
            // If no perfect match, use first result
            const bookInfo = data.items[0].volumeInfo;
            let description = bookInfo.description || 'A compelling read selected for our literary society.';
            if (description.includes('<')) {
              description = description.replace(/<[^>]*>/g, '');
            }
            
            let isbn = null;
            let alternateIsbns = [];
            
            if (bookInfo.industryIdentifiers) {
              const isbn13 = bookInfo.industryIdentifiers.find(id => id.type === 'ISBN_13');
              const isbn10 = bookInfo.industryIdentifiers.find(id => id.type === 'ISBN_10');
              isbn = isbn13?.identifier || isbn10?.identifier;
              
              alternateIsbns = bookInfo.industryIdentifiers
                .filter(id => id.type.includes('ISBN'))
                .map(id => id.identifier)
                .filter(id => id !== isbn);
            }
            
            return {
              title: bookInfo.title || currentBook.title,
              author: bookInfo.authors ? bookInfo.authors.join(', ') : currentBook.author,
              description: description,
              isbn: isbn,
              alternateIsbns: alternateIsbns,
              publishedDate: bookInfo.publishedDate,
              pageCount: bookInfo.pageCount,
              categories: bookInfo.categories,
              thumbnail: bookInfo.imageLinks?.thumbnail
            };
          }
        }
      } catch (error) {
        console.log('Book search failed:', error);
      }
      
      // Fallback if search fails
      console.log('Using fallback book details');
      return {
        title: currentBook.title,
        author: currentBook.author,
        description: 'A compelling read selected for our literary society.',
        isbn: null,
        alternateIsbns: [],
        thumbnail: null
      };
    };

    // Fetch book details
    const bookDetails = await fetchBookDetails();

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BookSpank — Gentleman's Literary Society</title>
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --mahogany: #c04000;
            --deep-burgundy: #722f37;
            --dark-leather: #3c2415;
            --warm-gold: #d4af37;
            --cream-parchment: #f4f1e8;
            --soft-shadow: rgba(0, 0, 0, 0.15);
            --warm-shadow: rgba(196, 64, 0, 0.1);
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Inter', sans-serif;
            background: linear-gradient(45deg, var(--dark-leather) 0%, #2c1810 50%, var(--deep-burgundy) 100%);
            min-height: 100vh;
            color: var(--cream-parchment);
            overflow-x: hidden;
        }
        
        .page-container {
            min-height: 100vh;
            display: grid;
            grid-template-columns: 1fr 1fr;
            position: relative;
        }
        
        .left-panel {
            background: 
                radial-gradient(circle at 20% 10%, rgba(212, 175, 55, 0.12) 0%, transparent 40%),
                radial-gradient(circle at 85% 85%, rgba(196, 64, 0, 0.08) 0%, transparent 45%),
                linear-gradient(160deg, var(--dark-leather) 0%, #2c1810 40%, #1a0f08 100%);
            padding: 3rem;
            display: flex;
            flex-direction: column;
            justify-content: center;
            position: relative;
            border-right: 3px solid rgba(212, 175, 55, 0.15);
        }
        
        .left-panel::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: 
                url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><defs><pattern id="leather" width="100" height="100" patternUnits="userSpaceOnUse"><circle cx="25" cy="25" r="0.8" fill="rgba(212,175,55,0.04)"/><circle cx="75" cy="75" r="0.6" fill="rgba(212,175,55,0.03)"/><circle cx="50" cy="10" r="0.4" fill="rgba(160,82,45,0.05)"/><circle cx="10" cy="60" r="0.5" fill="rgba(212,175,55,0.03)"/><circle cx="90" cy="40" r="0.7" fill="rgba(160,82,45,0.04)"/></pattern></defs><rect width="100" height="100" fill="url(%23leather)"/></svg>'),
                repeating-linear-gradient(
                    45deg,
                    transparent,
                    transparent 150px,
                    rgba(212, 175, 55, 0.02) 151px,
                    rgba(212, 175, 55, 0.02) 152px,
                    transparent 153px
                );
            pointer-events: none;
            opacity: 0.6;
        }
        
        .bookshelf-accent {
            position: absolute;
            top: 2rem;
            left: 2rem;
            right: 2rem;
            height: 200px;
            perspective: 1000px;
        }
        
        .bookshelf-container {
            display: flex;
            align-items: end;
            gap: 2px;
            height: 100%;
            position: relative;
            padding: 0 1rem;
        }
        
        .bookshelf-container::before {
            content: '';
            position: absolute;
            bottom: -8px;
            left: 0;
            right: 0;
            height: 8px;
            background: linear-gradient(90deg, 
                rgba(139, 69, 19, 0.8) 0%, 
                rgba(160, 82, 45, 0.9) 50%, 
                rgba(139, 69, 19, 0.8) 100%);
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }
        
        .book-spine {
            position: relative;
            border-radius: 0 3px 3px 0;
            box-shadow: 
                inset -3px 0 6px rgba(0,0,0,0.4),
                inset 0 0 0 1px rgba(255,255,255,0.1),
                2px 0 4px rgba(0,0,0,0.2);
            transform-style: preserve-3d;
            transition: transform 0.3s ease;
            cursor: pointer;
            overflow: hidden;
        }
        
        .book-spine:hover {
            transform: translateX(-3px) rotateY(-5deg);
        }
        
        .book-spine::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(90deg, 
                rgba(255,255,255,0.1) 0%, 
                transparent 30%, 
                rgba(0,0,0,0.1) 100%);
            pointer-events: none;
        }
        
        .book-spine::after {
            content: attr(data-title) " • " attr(data-author);
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(-90deg);
            color: rgba(255,255,255,0.9);
            font-size: 9px;
            font-weight: 600;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
            white-space: nowrap;
            font-family: 'Playfair Display', serif;
            letter-spacing: 0.3px;
            text-align: center;
        }
        
        /* Psychology/Consciousness - Deep Purple */
        .book-spine:nth-child(1) {
            width: 16px;
            height: 175px;
            background: linear-gradient(180deg, #4a148c 0%, #3a1066 50%, #2a0b4a 100%);
        }
        
        /* Science - Electric Blue */
        .book-spine:nth-child(2) {
            width: 14px;
            height: 165px;
            background: linear-gradient(180deg, #1e3a8a 0%, #1e40af 50%, #1d4ed8 100%);
        }
        
        /* Spirituality/Philosophy - Golden */
        .book-spine:nth-child(3) {
            width: 12px;
            height: 145px;
            background: linear-gradient(180deg, #b8860b 0%, #8b6914 50%, #654a0a 100%);
        }
        
        /* Existentialism - Dark Grey */
        .book-spine:nth-child(4) {
            width: 13px;
            height: 155px;
            background: linear-gradient(180deg, #4b5563 0%, #374151 50%, #1f2937 100%);
        }
        
        /* Ancient Philosophy - Rich Green */
        .book-spine:nth-child(5) {
            width: 11px;
            height: 135px;
            background: linear-gradient(180deg, #1a4d2e 0%, #0f3d1e 50%, #0a2714 100%);
        }
        
        /* Political/Lobbying - Dark Red */
        .book-spine:nth-child(6) {
            width: 17px;
            height: 170px;
            background: linear-gradient(180deg, #8b2635 0%, #5d1a24 50%, #3d1117 100%);
        }
        
        /* Holocaust/Meaning - Deep Brown */
        .book-spine:nth-child(7) {
            width: 15px;
            height: 160px;
            background: linear-gradient(180deg, #8b4513 0%, #6b3410 50%, #4a230b 100%);
        }
        
        /* American History/Guns - Steel Blue */
        .book-spine:nth-child(8) {
            width: 14px;
            height: 150px;
            background: linear-gradient(180deg, #475569 0%, #334155 50%, #1e293b 100%);
        }
        
        /* Civil Rights - Royal Purple */
        .book-spine:nth-child(9) {
            width: 16px;
            height: 180px;
            background: linear-gradient(180deg, #6b21a8 0%, #581c87 50%, #44337a 100%);
        }
        
        /* Education/Intellectual History - Burgundy */
        .book-spine:nth-child(10) {
            width: 18px;
            height: 185px;
            background: linear-gradient(180deg, #7c2d12 0%, #581c0d 50%, #3c1408 100%);
        }
        
        /* Sci-Fi/Vonnegut - Teal */
        .book-spine:nth-child(11) {
            width: 13px;
            height: 155px;
            background: linear-gradient(180deg, #0f766e 0%, #0d5450 50%, #042f2e 100%);
        }
        
        /* Economics/Marx - Bold Red */
        .book-spine:nth-child(12) {
            width: 15px;
            height: 190px;
            background: linear-gradient(180deg, #dc2626 0%, #b91c1c 50%, #7f1d1d 100%);
        }
        
        /* Media/Propaganda - Dark Navy */
        .book-spine:nth-child(13) {
            width: 19px;
            height: 175px;
            background: linear-gradient(180deg, #1e293b 0%, #0f172a 50%, #020617 100%);
        }
        
        .current-book-display {
            max-width: 400px;
            margin-top: 2rem;
        }
        
        
        .book-3d {
            width: 280px;
            height: 400px;
            position: relative;
            margin: 2rem 0;
            transform: perspective(1000px) rotateY(-15deg) rotateX(5deg);
            transition: transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .book-3d:hover {
            transform: perspective(1000px) rotateY(-10deg) rotateX(2deg) translateZ(10px);
        }
        
        .book-cover {
            position: absolute;
            width: 100%;
            height: 100%;
            border-radius: 6px;
            box-shadow: 
                0 20px 40px rgba(0,0,0,0.4),
                inset 0 1px 0 rgba(255,255,255,0.1);
            position: relative;
            overflow: hidden;
            background: linear-gradient(145deg, #8b4513 0%, #a0522d 30%, #cd853f 100%);
        }
        
        .book-cover-image {
            width: 100%;
            height: 100%;
            object-fit: cover;
            border-radius: 6px;
        }
        
        .book-cover-fallback {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            color: var(--cream-parchment);
            text-align: center;
            padding: 2rem;
            font-family: 'Playfair Display', serif;
            background: linear-gradient(145deg, #8b4513 0%, #a0522d 30%, #cd853f 100%);
        }
        
        .book-cover-fallback::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: 
                radial-gradient(circle at 20% 30%, rgba(255,255,255,0.1) 0%, transparent 40%),
                linear-gradient(45deg, transparent 30%, rgba(0,0,0,0.05) 50%, transparent 70%);
        }
        
        .book-spine-3d {
            position: absolute;
            left: -12px;
            top: 0;
            width: 12px;
            height: 100%;
            background: linear-gradient(180deg, #654321, #4a2c17);
            transform: rotateY(-90deg);
            transform-origin: right;
            box-shadow: inset 0 0 10px rgba(0,0,0,0.5);
        }
        
        .book-title-3d {
            font-size: 2.2rem;
            font-weight: 800;
            letter-spacing: -1px;
            margin-bottom: 0.5rem;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
            z-index: 1;
            position: relative;
        }
        
        .book-author-3d {
            font-size: 1.1rem;
            font-weight: 400;
            font-style: italic;
            opacity: 0.9;
            z-index: 1;
            position: relative;
        }
        
        .reading-status {
            background: rgba(244, 241, 232, 0.95);
            color: var(--dark-leather);
            padding: 1rem 1.5rem;
            border-radius: 8px;
            margin-top: 2rem;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(212, 175, 55, 0.2);
        }
        
        .status-badge {
            background: var(--mahogany);
            color: white;
            padding: 0.3rem 0.8rem;
            border-radius: 15px;
            font-size: 0.8rem;
            font-weight: 600;
            display: inline-block;
            margin-bottom: 0.5rem;
        }
        
        .right-panel {
            background: var(--cream-parchment);
            color: var(--dark-leather);
            padding: 4rem 3rem;
            display: flex;
            flex-direction: column;
            justify-content: center;
            position: relative;
            overflow: hidden;
        }
        
        .right-panel::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: 
                radial-gradient(circle at 70% 20%, rgba(212, 175, 55, 0.05) 0%, transparent 50%),
                url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60"><defs><pattern id="paper" width="60" height="60" patternUnits="userSpaceOnUse"><path d="M0 0h60v60H0z" fill="%23f4f1e8"/><path d="M30 0v60M0 30h60" stroke="%23f0ede4" stroke-width="0.5" opacity="0.3"/></pattern></defs><rect width="60" height="60" fill="url(%23paper)"/></svg>');
            opacity: 0.4;
            pointer-events: none;
        }
        
        .header-section {
            margin-bottom: 3rem;
            position: relative;
            z-index: 1;
        }
        
        .main-title {
            font-family: 'Playfair Display', serif;
            font-size: 4rem;
            font-weight: 800;
            line-height: 0.9;
            margin-bottom: 0.5rem;
            background: linear-gradient(135deg, var(--mahogany), var(--deep-burgundy));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            text-shadow: none;
        }
        
        .subtitle {
            font-size: 1.2rem;
            color: var(--deep-burgundy);
            font-weight: 300;
            font-style: italic;
            margin-bottom: 2rem;
        }
        
        .current-read-info {
            background: white;
            padding: 2.5rem;
            border-radius: 12px;
            box-shadow: 0 10px 30px var(--soft-shadow);
            margin-bottom: 3rem;
            border-left: 4px solid var(--mahogany);
        }
        
        .current-read-label {
            color: var(--mahogany);
            font-size: 0.9rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 1rem;
        }
        
        .book-title-text {
            font-family: 'Playfair Display', serif;
            font-size: 2.5rem;
            font-weight: 700;
            color: var(--dark-leather);
            margin-bottom: 0.5rem;
        }
        
        .book-author-text {
            font-size: 1.3rem;
            color: var(--deep-burgundy);
            font-style: italic;
            margin-bottom: 1.5rem;
        }
        
        
        .meeting-info {
            background: linear-gradient(135deg, var(--mahogany), var(--deep-burgundy));
            color: white;
            padding: 1.5rem;
            border-radius: 8px;
            margin-top: 1.5rem;
        }
        
        
        @media (max-width: 1024px) {
            .page-container {
                grid-template-columns: 1fr;
            }
            
            .left-panel {
                padding: 2rem;
                border-right: none;
                border-bottom: 2px solid rgba(212, 175, 55, 0.1);
            }
            
            .main-title {
                font-size: 3rem;
            }
            
            .book-3d {
                width: 240px;
                height: 340px;
                margin: 1rem auto;
                transform: perspective(800px) rotateY(-10deg) rotateX(5deg);
            }
        }
        
        .book-update-btn {
            position: absolute;
            top: 1rem;
            right: 1rem;
            background: rgba(196, 64, 0, 0.9);
            color: white;
            border: none;
            padding: 0.5rem 1rem;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            backdrop-filter: blur(10px);
            z-index: 10;
        }
        
        .book-update-btn:hover {
            background: rgba(196, 64, 0, 1);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(196, 64, 0, 0.3);
        }
        
        .book-update-form {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: linear-gradient(135deg, var(--mahogany), var(--deep-burgundy));
            padding: 2rem;
            transform: translateY(-100%);
            transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            z-index: 1000;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        }
        
        .book-update-form.active {
            transform: translateY(0);
        }
        
        .form-container {
            max-width: 600px;
            margin: 0 auto;
            display: flex;
            gap: 1rem;
            align-items: end;
        }
        
        .form-group {
            flex: 1;
        }
        
        .form-group label {
            display: block;
            color: white;
            font-weight: 600;
            margin-bottom: 0.5rem;
            font-size: 0.9rem;
        }
        
        .form-group input {
            width: 100%;
            padding: 0.75rem;
            border: none;
            border-radius: 8px;
            font-size: 1rem;
            background: rgba(255, 255, 255, 0.95);
            color: var(--dark-leather);
        }
        
        .form-group input:focus {
            outline: none;
            box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.3);
        }
        
        .form-actions {
            display: flex;
            gap: 1rem;
        }
        
        .btn {
            padding: 0.75rem 1.5rem;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        
        .btn-primary {
            background: var(--warm-gold);
            color: var(--dark-leather);
        }
        
        .btn-primary:hover {
            background: #e6c547;
            transform: translateY(-2px);
        }
        
        .btn-secondary {
            background: transparent;
            color: white;
            border: 2px solid rgba(255, 255, 255, 0.5);
        }
        
        .btn-secondary:hover {
            background: rgba(255, 255, 255, 0.1);
            border-color: white;
        }
        
        .loading {
            opacity: 0.7;
            pointer-events: none;
        }
        
        .error-message {
            color: #ffcccb;
            font-size: 0.85rem;
            margin-top: 0.5rem;
        }
        
        @media (max-width: 768px) {
            .left-panel, .right-panel {
                padding: 1.5rem;
            }
            
            .main-title {
                font-size: 2.5rem;
            }
            
            .book-title-text {
                font-size: 2rem;
            }
            
            .book-3d {
                width: 200px;
                height: 280px;
            }
            
            .form-container {
                flex-direction: column;
                align-items: stretch;
            }
            
            .form-actions {
                width: 100%;
            }
            
            .btn {
                flex: 1;
            }
        }
    </style>
</head>
<body>
    <div class="book-update-form" id="updateForm">
        <div class="form-container">
            <div class="form-group">
                <label for="bookTitle">Book Title</label>
                <input type="text" id="bookTitle" placeholder="Enter book title..." value="${bookDetails.title}">
                <div class="error-message" id="titleError"></div>
            </div>
            <div class="form-group">
                <label for="bookAuthor">Author</label>
                <input type="text" id="bookAuthor" placeholder="Enter author name..." value="${bookDetails.author}">
                <div class="error-message" id="authorError"></div>
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-primary" id="updateBookBtn">Update Book</button>
                <button type="button" class="btn btn-secondary" id="cancelBtn">Cancel</button>
            </div>
        </div>
    </div>

    <div class="page-container">
        <div class="left-panel">
            <div class="bookshelf-accent">
                <div class="bookshelf-container">
                    <div class="book-spine" data-title="ORIGINS OF CONSCIOUSNESS" data-author="NEUMANN"></div>
                    <div class="book-spine" data-title="BRIEF HISTORY OF TIME" data-author="HAWKING"></div>
                    <div class="book-spine" data-title="THE ALCHEMIST" data-author="COELHO"></div>
                    <div class="book-spine" data-title="THE STRANGER" data-author="CAMUS"></div>
                    <div class="book-spine" data-title="MEDITATIONS" data-author="AURELIUS"></div>
                    <div class="book-spine" data-title="WOLVES OF K STREET" data-author="MULLINS"></div>
                    <div class="book-spine" data-title="SEARCH FOR MEANING" data-author="FRANKL"></div>
                    <div class="book-spine" data-title="GUN COUNTRY" data-author="MCKEVITT"></div>
                    <div class="book-spine" data-title="TESTAMENT OF HOPE" data-author="KING JR"></div>
                    <div class="book-spine" data-title="ANTI-INTELLECTUALISM" data-author="HOFSTADTER"></div>
                    <div class="book-spine" data-title="SIRENS OF TITAN" data-author="VONNEGUT"></div>
                    <div class="book-spine" data-title="CAPITAL" data-author="MARX"></div>
                    <div class="book-spine" data-title="MANUFACTURING CONSENT" data-author="HERMAN"></div>
                </div>
            </div>
            
            
            <div class="current-book-display">
                <div class="book-3d">
                    <div class="book-spine-3d"></div>
                    <div class="book-cover" id="bookCoverContainer">
                        <div class="book-cover-fallback">
                            <div class="book-title-3d">${bookDetails.title.replace(' ', '<br>')}</div>
                            <div class="book-author-3d">${bookDetails.author}</div>
                        </div>
                    </div>
                </div>
                
                <div class="reading-status">
                    <span class="status-badge">Currently Reading</span>
                    <p><strong>Next Discussion:</strong> Coming Soon</p>
                    <p><em>Progress updates shared weekly</em></p>
                </div>
            </div>
        </div>
        
        <div class="right-panel">
            <button class="book-update-btn" id="showUpdateForm">📚 Update Book</button>
            
            <div class="header-section">
                <h1 class="main-title">BookSpank</h1>
                <p class="subtitle">A Gentleman's Literary Society • Est. New Orleans</p>
            </div>
            
            <div class="current-read-info">
                <div class="current-read-label">Featured Selection</div>
                <h2 class="book-title-text">${bookDetails.title}</h2>
                <p class="book-author-text">${bookDetails.author}</p>
                
                <p>${bookDetails.description}</p>
                
                <div class="meeting-info">
                    <strong>Society Gathering</strong><br>
                    <em>Details forthcoming for our next literary discourse</em>
                </div>
                
                <div style="margin-top: 1rem; font-size: 0.8rem; color: #999; text-align: center;">
                    Book cover courtesy of <a href="https://openlibrary.org" target="_blank" style="color: var(--mahogany);">Open Library</a>
                </div>
            </div>
            
        </div>
    </div>

    <script>
        // Cover loading functionality with multiple fallbacks
        class CoverLoader {
            constructor(bookDetails) {
                this.bookDetails = bookDetails;
                this.container = document.getElementById('bookCoverContainer');
                this.fallbackDiv = this.container.querySelector('.book-cover-fallback');
                this.loadCover();
            }
            
            getCoverSources() {
                const sources = [];
                
                // 1. Google Books thumbnail (often highest quality and most available)
                if (this.bookDetails.thumbnail) {
                    sources.push(this.bookDetails.thumbnail.replace('&zoom=1', '&zoom=0')); // Higher res
                    sources.push(this.bookDetails.thumbnail);
                }
                
                // 2. Open Library by primary ISBN
                if (this.bookDetails.isbn) {
                    sources.push(\`https://covers.openlibrary.org/b/isbn/\${this.bookDetails.isbn}-L.jpg\`);
                    sources.push(\`https://covers.openlibrary.org/b/isbn/\${this.bookDetails.isbn}-M.jpg\`);
                }
                
                // 3. Try alternate ISBNs
                if (this.bookDetails.alternateIsbns) {
                    this.bookDetails.alternateIsbns.forEach(isbn => {
                        sources.push(\`https://covers.openlibrary.org/b/isbn/\${isbn}-L.jpg\`);
                        sources.push(\`https://covers.openlibrary.org/b/isbn/\${isbn}-M.jpg\`);
                    });
                }
                
                return sources.filter(Boolean); // Remove any null/undefined sources
            }
            
            async loadCover() {
                const sources = this.getCoverSources();
                console.log('Attempting to load cover from sources:', sources);
                
                if (sources.length === 0) {
                    console.log('No cover sources available, using fallback');
                    return;
                }
                
                // Try each source until one works
                for (const src of sources) {
                    if (await this.tryLoadImage(src)) {
                        this.showImage(src);
                        return;
                    }
                }
                
                console.log('All cover sources failed, using fallback');
            }
            
            tryLoadImage(src) {
                return new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                        // Check if it's a real image (not a 1x1 placeholder)
                        if (img.width > 10 && img.height > 10) {
                            resolve(true);
                        } else {
                            resolve(false);
                        }
                    };
                    img.onerror = () => resolve(false);
                    img.src = src;
                    
                    // Timeout after 3 seconds
                    setTimeout(() => resolve(false), 3000);
                });
            }
            
            showImage(src) {
                const img = document.createElement('img');
                img.src = src;
                img.alt = \`\${this.bookDetails.title} by \${this.bookDetails.author}\`;
                img.className = 'book-cover-image';
                
                // Hide fallback and show image
                this.fallbackDiv.style.display = 'none';
                this.container.appendChild(img);
                
                console.log('Successfully loaded cover:', src);
            }
        }

        // Book management functionality
        class BookManager {
            constructor() {
                this.form = document.getElementById('updateForm');
                this.showBtn = document.getElementById('showUpdateForm');
                this.updateBtn = document.getElementById('updateBookBtn');
                this.cancelBtn = document.getElementById('cancelBtn');
                this.titleInput = document.getElementById('bookTitle');
                this.authorInput = document.getElementById('bookAuthor');
                
                this.init();
            }
            
            init() {
                // Load saved book from localStorage
                this.loadSavedBook();
                
                // Event listeners
                this.showBtn.addEventListener('click', () => this.showForm());
                this.cancelBtn.addEventListener('click', () => this.hideForm());
                this.updateBtn.addEventListener('click', () => this.updateBook());
                
                // Handle escape key
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') this.hideForm();
                });
                
                // Handle enter key in inputs
                [this.titleInput, this.authorInput].forEach(input => {
                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') this.updateBook();
                    });
                });
            }
            
            loadSavedBook() {
                const saved = localStorage.getItem('bookspank_current_book');
                if (saved) {
                    const book = JSON.parse(saved);
                    this.titleInput.value = book.title;
                    this.authorInput.value = book.author;
                }
            }
            
            showForm() {
                this.form.classList.add('active');
                this.titleInput.focus();
            }
            
            hideForm() {
                this.form.classList.remove('active');
                this.clearErrors();
            }
            
            clearErrors() {
                document.getElementById('titleError').textContent = '';
                document.getElementById('authorError').textContent = '';
            }
            
            validateInputs() {
                const title = this.titleInput.value.trim();
                const author = this.authorInput.value.trim();
                let valid = true;
                
                this.clearErrors();
                
                if (!title) {
                    document.getElementById('titleError').textContent = 'Book title is required';
                    valid = false;
                }
                
                if (!author) {
                    document.getElementById('authorError').textContent = 'Author name is required';
                    valid = false;
                }
                
                return valid;
            }
            
            async updateBook() {
                console.log('updateBook called');
                
                if (!this.validateInputs()) {
                    console.log('Validation failed');
                    return;
                }
                
                const title = this.titleInput.value.trim();
                const author = this.authorInput.value.trim();
                
                console.log('Updating book with:', { title, author });
                
                // Show loading state
                this.updateBtn.textContent = 'Updating...';
                this.updateBtn.classList.add('loading');
                
                try {
                    console.log('Sending request to /api/book');
                    
                    // Send to server API
                    const response = await fetch('/api/book', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ title, author })
                    });
                    
                    console.log('Response status:', response.status);
                    console.log('Response ok:', response.ok);
                    
                    if (!response.ok) {
                        const errorText = await response.text();
                        console.error('Error response:', errorText);
                        
                        let errorMessage = 'Failed to update book';
                        try {
                            const errorJson = JSON.parse(errorText);
                            errorMessage = errorJson.error || errorMessage;
                        } catch (parseError) {
                            errorMessage = \`Server error (\${response.status})\`;
                        }
                        
                        throw new Error(errorMessage);
                    }
                    
                    const result = await response.json();
                    console.log('Book updated successfully:', result.book);
                    
                    // Also save to localStorage as backup
                    localStorage.setItem('bookspank_current_book', JSON.stringify({ title, author }));
                    
                    // Reload page to show new book
                    console.log('Reloading page...');
                    window.location.reload();
                    
                } catch (error) {
                    console.error('Error updating book:', error);
                    document.getElementById('titleError').textContent = error.message || 'Failed to update book. Please try again.';
                } finally {
                    // Reset button state
                    this.updateBtn.textContent = 'Update Book';
                    this.updateBtn.classList.remove('loading');
                }
            }
        }
        
        // Book details from server
        const bookDetails = ${JSON.stringify(bookDetails)};
        
        // Initialize when page loads
        document.addEventListener('DOMContentLoaded', () => {
            new CoverLoader(bookDetails);
            new BookManager();
        });
        
        // Also initialize if already loaded
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                new CoverLoader(bookDetails);
                new BookManager();
            });
        } else {
            new CoverLoader(bookDetails);
            new BookManager();
        }
    </script>
</body>
</html>`;

    return new Response(html, {
      headers: {
        "Content-Type": "text/html",
      },
    });
  }
};