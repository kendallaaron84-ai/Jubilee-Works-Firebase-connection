<?php
if ( ! defined( 'ABSPATH' ) ) exit;

add_shortcode('koba_bookshelf', function($atts) {
    if (!class_exists('Easy_Digital_Downloads')) return '<p style="color:white;">Store not active.</p>';

    // 1. Get Audiobooks
    $args = [ 'post_type' => 'download', 'posts_per_page' => -1, 'post_status' => 'publish' ];
    $books = get_posts($args);
    
    if (empty($books)) return '<p style="color:white;">No audiobooks found.</p>';

    $user_id = get_current_user_id();
    $output = '<div class="koba-bookshelf-grid">';

    foreach ($books as $book) {
        $id = $book->ID;
        $title = get_the_title($id);
        $slug = $book->post_name; 
        $price = edd_get_download_price($id);
        $image_url = get_the_post_thumbnail_url($id, 'large') ?: 'https://via.placeholder.com/300?text=Audiobook';
        
        // Check Access
        $has_access = is_user_logged_in() && edd_has_user_purchased($user_id, $id);

        if ($has_access) {
            /** * THE SCALABLE FIX: 
             * Format: /author-slug/player/book-slug/
             */
            $author_id   = $book->post_author;
            $author_slug = get_the_author_meta('user_nicename', $author_id);
            $book_slug   = $book->post_name; 

            // Standardized Ghost Route
            $listen_url = home_url("/{$author_slug}/player/{$book_slug}/");
            $css_class = 'koba-book-owned';
            $status_icon = '✅ Owned';
            
            // Premium SVG Listen Button
            $icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px;"><path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path></svg>';
            $btn_html = '<a href="' . esc_url($listen_url) . '" class="koba-listen-btn">' . $icon . ' Listen Now</a>';
            
        } else {
            $css_class = 'koba-book-locked';
            $status_icon = '🔒 Locked';
            $btn_html = '<a href="/checkout?edd_action=add_to_cart&download_id='.$id.'" class="k-btn-buy">Get for $'.$price.'</a>';
        }

        $output .= '
        <div class="koba-book-card '. $css_class .'">
            <div class="k-book-cover" style="background-image:url('.$image_url.')"><span class="k-book-badge">'. $status_icon .'</span></div>
            <div class="k-book-details"><h4>'. $title .'</h4>'. $btn_html .'</div>
        </div>';
    }
    
    // Updated Grid & Premium Button CSS
    $output .= '</div><style>
    .koba-bookshelf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 20px; } 
    .koba-book-card { background:#fff; border-radius:8px; overflow:hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.05); } 
    .k-book-cover { height:250px; background-size:cover; position:relative; } 
    .koba-book-locked .k-book-cover { filter:grayscale(100%); opacity:0.8; } 
    .k-book-badge { position:absolute; top:10px; right:10px; background:rgba(0,0,0,0.8); color:white; padding:4px 8px; border-radius:4px; font-size:11px; } 
    .k-book-details { padding:15px; text-align:center; display: flex; flex-direction: column; align-items: center; } 
    .k-book-details h4 { margin: 0 0 12px 0; font-size: 16px; color: #1a1a1a; font-weight: 600; line-height: 1.3; }

    /* The Sleek New Listen Button */
    .koba-listen-btn { display: inline-flex !important; align-items: center; justify-content: center; background-color: #f97316 !important; color: #ffffff !important; padding: 10px 22px !important; border-radius: 8px !important; text-decoration: none !important; font-weight: 600; font-size: 14px; transition: background-color 0.2s ease; box-shadow: 0 4px 15px rgba(249, 115, 22, 0.3); } 
    .koba-listen-btn:hover { background-color: #e65100 !important; } 
    .koba-listen-btn svg { display: block !important; }

    /* The Updated Buy Button */
    .k-btn-buy { display:inline-block; background:#334155; color:white; padding:10px 22px; text-decoration:none; border-radius:8px; font-weight:600; font-size: 14px; transition: background-color 0.2s ease; }
    .k-btn-buy:hover { background: #1e293b; }
    </style>';
    
    return $output;
});