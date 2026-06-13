<?php
/**
 * Plugin Name: KOBA-I Audio
 * Version: 3.8.0
 * Description: Tier-1 Audiobook & Video Player with Secure Cloud Studio.
 * Author: Kendall Aaron
 * Text Domain: koba-i-audio
 */

if ( ! defined( 'ABSPATH' ) ) exit;

/*
 * -----------------------------------------------------------------------------
 * AUTO-UPDATER INTEGRATION
 * -----------------------------------------------------------------------------
 */
require_once plugin_dir_path( __FILE__ ) . 'includes/updater.php';
if ( class_exists( 'KobaAudioUpdater' ) ) {
    $updater = new KobaAudioUpdater( __FILE__ );
    $updater->set_username( 'koba-i' );
    $updater->set_repository( 'https://audio.koba-i.com/updates/info.json' );
    $updater->initialize();
}

// 1. CONSTANTS
define( 'KOBA_IA_PATH', plugin_dir_path( __FILE__ ) );
define( 'KOBA_IA_URL', plugin_dir_url( __FILE__ ) );

// 2. LOAD DEPENDENCIES
if ( file_exists( KOBA_IA_PATH . 'vendor/autoload.php' ) ) {
    require_once KOBA_IA_PATH . 'vendor/autoload.php';
}

$modules = [
    'includes/safety-sentinel.php',
    'includes/ai-engine.php',
    'includes/ai-processor.php',
    'includes/streaming.php',
    'includes/ajax.php',
    'includes/admin.php',
    'includes/security.php',
    // 'includes/edd-bridge.php', // 🛑 Decommissioned
    'includes/shortcodes-v2.php', 
    'includes/updater.php',
];
foreach ($modules as $module) {
    if ( file_exists( KOBA_IA_PATH . $module ) ) require_once KOBA_IA_PATH . $module;
}

// 3. REGISTER POST TYPE
add_action('init', function() {
    register_post_type('koba_publication', [
        'labels'      => ['name' => 'Publications', 'singular_name' => 'Publication', 'add_new_item' => 'Add New Audiobook'],
        'public'      => true, 
        'show_ui'     => true, 
        'show_in_menu' => true,
        'menu_icon'   => 'dashicons-album',
        'supports'    => ['title'],
        'show_in_rest' => true
    ]);
});

/**
 * KOBA-I: THE SOVEREIGN GATE INTERCEPTOR
 * Intercepts /{author}/player/{book}/ URLs and validates against Firebase Entitlements
 */
add_action('template_redirect', function() {
    $path = trim(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/');
    $parts = explode('/', $path);

    $player_index = array_search('player', $parts);

    if ($player_index !== false && isset($parts[$player_index + 1])) {
        $book_slug = $parts[$player_index + 1];
        
        // 🔑 FIX: Look up the book in your active custom publications table
        $book = get_page_by_path($book_slug, OBJECT, 'koba_publication');

        if (!$book) {
            return; 
        }

        $book_id = $book->ID;
        $asset_key = get_post_meta($book_id, 'koba_asset_key', true) ?: 'bk_koba_' . $book_id;
        $current_user_email = is_user_logged_in() ? wp_get_current_user()->user_email : '';

        // Render Secure App Shell with Async Serverless Gatekeeper
        ?>
        <!DOCTYPE html>
        <html <?php language_attributes(); ?>>
        <head>
            <meta charset="<?php bloginfo( 'charset' ); ?>">
            <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
            <style>
                .koba-gate-loading { background: #000; color: #fff; height: 100vh; display: flex; align-items: center; justify-content: center; font-family: sans-serif; font-weight: bold; }
                .koba-lock-screen { background: #0d1117; color: #c9d1d9; height: 100vh; display: flex; align-items: center; justify-content: center; font-family: sans-serif; text-align: center; }
                .koba-lock-box { background: #161b22; border: 1px solid #30363d; padding: 40px; border-radius: 8px; max-width: 400px; }
                .koba-lock-btn { display: inline-block; background: #f97316; color: #000; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 20px; }
            </style>
            <?php wp_head(); ?>
        </head>
        <body style="margin:0; padding:0; background:#000;">

            <div id="koba-auth-gate" class="koba-gate-loading">Verifying Secure Vault Access...</div>

            <script>
            document.addEventListener("DOMContentLoaded", function() {
                const readerEmail = "<?php echo esc_js($current_user_email); ?>";
                const assetKey = "<?php echo esc_js($asset_key); ?>";
                const centralDashboardUrl = "http://localhost:3000";

                if (!readerEmail) {
                    renderLockedUI();
                    return;
                }

                fetch(centralDashboardUrl + "/api/verify-entitlement", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        userEmail: readerEmail,
                        assetKey: assetKey,
                        requestingDomain: window.location.hostname
                    })
                })
                .then(res => res.json())
                .then(auth => {
                    if (auth.authenticated && auth.owned) {
                        document.getElementById("koba-auth-gate").remove();
                        // Initialize player assets natively
                        if (window.bootKobaPlayer) window.bootKobaPlayer();
                    } else {
                        renderLockedUI();
                    }
                })
                .catch(() => renderLockedUI());

                function renderLockedUI() {
                    document.getElementById("koba-auth-gate").outerHTML = `
                    <div class="koba-lock-screen">
                        <div class="koba-lock-box">
                            <h3>🔒 Access Key Required</h3>
                            <p>You must purchase access to link this publication to your digital vault.</p>
                            <a href="/bookshelf/" class="koba-lock-btn">Return to Bookshelf</a>
                        </div>
                    </div>`;
                }
            });
            </script>

            <?php 
            // Load the player core markup natively under the publication ID
            koba_render_sovereign_player_engine($book_id); 
            ?>
        </body>
        </html>
        <?php
        exit;
    }
});

/**
 * 4. THE CORE SOUNDWAVE RUNTIME
 */
function koba_render_sovereign_player_engine($post_id) {
    $chapters_json = get_post_meta($post_id, '_koba_chapters_data', true);
    $chapters = json_decode($chapters_json, true) ?: [];
    
    foreach ($chapters as &$chapter) {
        $source_url = $chapter['url'] ?? '';
        if (empty($chapter['transcript_file_url']) && !empty($source_url)) {
            if (strpos($source_url, 'koba-ai-processing-vault') !== false && strpos($source_url, '/audio-sources/') !== false) {
                $predicted_url = str_replace('/audio-sources/', '/transcripts/', $source_url);
                $chapter['transcript_file_url'] = $predicted_url . '.json';
            }
        }
        $chapter['url'] = get_rest_url(null, "koba-ia/v2/stream/{$chapter['id']}");
    }
    
    $cover    = get_post_meta($post_id, '_koba_cover_art_url', true);
    $bg_image = get_post_meta($post_id, '_koba_bg_image_url', true);
    
    wp_enqueue_script('koba-bloom-js', KOBA_IA_URL . 'assets/bloom-player.js', [], '3.7.4', true);
    wp_enqueue_style('koba-bloom-css', KOBA_IA_URL . 'assets/bloom-style.css', [], '3.7.4');
    
    ?>
    <script>
    window.bootKobaPlayer = function() {
        window.kobaData = {
            title: "<?php echo esc_js(get_the_title($post_id)); ?>",
            coverUrl: "<?php echo esc_url($cover); ?>",
            bgImage: "<?php echo esc_url($bg_image); ?>",
            logoUrl: "<?php echo esc_url(KOBA_IA_URL . 'assets/koba-logo-text.png'); ?>",
            chapters: <?php echo json_encode($chapters); ?>
        };
        // Trigger Bloom rendering context
        if (typeof renderBloomRoot === "function") { renderBloomRoot(); }
    };
    </script>
    <div id="koba-bloom-root"></div>
    <?php
    wp_footer();
}

// 5. STUDIO REDIRECT
add_filter('get_edit_post_link', function($link, $post_id) {
    if (get_post_type($post_id) === 'koba_publication') {
        return admin_url("edit.php?post_type=koba_publication&page=koba-studio&post=$post_id");
    }
    return $link;
}, 10, 2);

add_action('admin_menu', function() {
    add_submenu_page('edit.php?post_type=koba_publication', 'KOBA Studio', 'Studio', 'edit_posts', 'koba-studio', 'koba_render_production_suite');
});

/* =========================================================================
   6. COMMAND CENTER SYNC ENGINE (CORS HANDSHAKE)
========================================================================= */
add_action('rest_api_init', 'initialize_koba_studio_cors_policy', 5);
function initialize_koba_studio_cors_policy() {
    add_filter('rest_pre_serve_request', function($value, $result, $request) {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        $has_studio_key = !empty($_SERVER['HTTP_X_STUDIO_KEY']) || !empty($_SERVER['HTTP_X_KOBAI_LICENSE_KEY']);
        
        if ($origin === 'https://dashboard.koba-i.com' || $origin === 'http://localhost:3000' || $has_studio_key) {
            header("Access-Control-Allow-Origin: " . ($origin ? $origin : "*"));
            header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
            header("Access-Control-Allow-Credentials: true");
            header("Access-Control-Allow-Headers: Authorization, Content-Type, X-WP-Nonce, X-KOBAI-License-Key, X-Studio-Key");
            
            if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
                status_header(200);
                exit;
            }
        }
        return $value;
    }, 10, 3);
}

// 🌐 ADMIN SIDEBAR SHORTCUT LINKS
add_action('admin_menu', 'register_koba_audio_dashboard_links', 20);
function register_koba_audio_dashboard_links() {
    add_submenu_page('edit.php?post_type=koba_publication', 'Central Dashboard', '➡️ KOBA-I Dashboard', 'manage_options', 'https://dashboard.koba-i.com');
    add_submenu_page('edit.php?post_type=koba_publication', 'Request Narration Pipeline', '🎙️ Request Narration', 'manage_options', 'https://dashboard.koba-i.com/nexus-engine');
}