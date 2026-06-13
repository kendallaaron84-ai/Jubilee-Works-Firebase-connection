<?php
/**
 * Plugin Name: Jubilee Works Command Center
 * Plugin URI: https://koba-i.com
 * Description: Secure e-book media player and authoring studio for KOBA-I Audio.
 * Version: 1.0.2
 * Author: KOBA-I
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class Jubilee_Works_Studio {

    public function __construct() {
        add_action( 'admin_menu', array( $this, 'register_studio_page' ) );
        add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_react_app' ) );
        add_action( 'rest_api_init', array( $this, 'register_api_endpoints' ) );
        add_action( 'init', array( $this, 'register_secure_manuscripts' ) );
        
        // 🔑 FIXED: Appended the accepted argument signature counter parameter (3)
        add_action( 'rest_api_init', array( $this, 'initialize_jubilee_cors_policy' ), 5, 3 );
    }

    public function initialize_jubilee_cors_policy() {
        add_filter('rest_pre_serve_request', function($value, $result, $request) {
            $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
            
            $allowed_origins = [
                'http://localhost:3000',
                'https://dashboard.koba-i.com'
            ];
            
            if (in_array($origin, $allowed_origins)) {
                header("Access-Control-Allow-Origin: " . $origin);
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
    
    public function register_secure_manuscripts() {
        register_post_type( 'jubilee_manuscript', array(
            'label'               => 'Manuscripts',
            'public'              => false, 
            'show_ui'             => false, 
            'show_in_rest'        => true,
            'rest_base'           => 'manuscripts',
            'capability_type'     => 'post',
            'map_meta_cap'        => true,  
            'supports'            => array( 'title', 'editor', 'author', 'custom-fields' ),
        ) );
    }
    
    public function register_studio_page() {
        add_menu_page( 'Jubilee Studio', 'Jubilee Studio', 'manage_options', 'jubilee-works', array( $this, 'render_react_root' ), 'dashicons-book-alt', 6 );
    }

    public function render_react_root() { echo '<div class="wrap"><div id="root"></div></div>'; }

    public function enqueue_react_app( $hook ) {
    if ( 'toplevel_page_jubilee-works' !== $hook ) return;

    $plugin_url = plugin_dir_url( __FILE__ );
    
    // Use absolute paths
    $css_path = plugin_dir_path( __FILE__ ) . 'dist/index.css';
    $js_path = plugin_dir_path( __FILE__ ) . 'dist/index.js';

    if ( file_exists( $css_path ) ) {
        wp_enqueue_style( 'jubilee-works-styles', $plugin_url . 'dist/index.css', array(), filemtime( $css_path ) );
    }

    if ( file_exists( $js_path ) ) {
        wp_enqueue_script( 'jubilee-works-script', $plugin_url . 'dist/index.js', array( 'wp-element' ), filemtime( $js_path ), true );

        $license_key = get_option('kobai_license_key', '');
        wp_localize_script( 'jubilee-works-script', 'kobaConfig', array(
            'restUrl'     => esc_url_raw( rest_url() ),
            'nonce'       => wp_create_nonce( 'wp_rest' ),
            'user'        => wp_get_current_user()->user_email,
            'licenseKey'  => $license_key 
        ) );
    }
}

    public function register_api_endpoints() {
        register_rest_route( 'jubilee/v1', '/generate', array(
            'methods' => 'POST', 'callback' => array( $this, 'handle_gemini_request' ), 'permission_callback' => '__return_true'
        ));
        register_rest_route( 'jubilee/v1', '/telemetry', array(
            'methods' => 'POST', 'callback' => array( $this, 'handle_telemetry' ), 'permission_callback' => '__return_true'
        ));
    }

    public function handle_telemetry( WP_REST_Request $request ) {
        $incoming_key = $request->get_header('X-KOBAI-License-Key');
        if ( empty($incoming_key) || $incoming_key !== get_option('kobai_license_key') ) {
            return new WP_Error( 'unauthorized', 'Invalid Studio Key', array( 'status' => 401 ) );
        }
        
        $data = $request->get_json_params();
        error_log("KOBA-I Telemetry Received: " . print_r($data, true));
        return rest_ensure_response( array('status' => 'synced') );
    }

    public function handle_gemini_request( WP_REST_Request $request ) {
        $parameters = $request->get_json_params();
        $prompt = $parameters['prompt'] ?? '';
        
        if ( empty( $prompt ) ) {
            return new WP_Error( 'no_prompt', 'Prompt required', array( 'status' => 400 ) );
        }

        $payload = array(
            'prompt'            => sanitize_text_field($prompt),
            'temperature'       => floatval($parameters['temperature'] ?? 0.7),
            'maxOutputTokens'   => intval($parameters['maxOutputTokens'] ?? 800),
            'systemInstruction' => sanitize_text_field($parameters['systemInstruction'] ?? 'You are a professional editorial writing companion.')
        );

        $firebase_url = 'https://us-central1-author-jubilee-command-center.cloudfunctions.net/generate_story_content'; 
        $response = wp_remote_post( $firebase_url, array(
            'headers' => array( 
                'Content-Type' => 'application/json', 
                'X-KOBAI-License-Key' => get_option('kobai_license_key', '')
            ),
            'body'    => wp_json_encode( $payload ),
            'timeout' => 45, 
            'sslverify' => false 
        ));

        if ( is_wp_error( $response ) ) {
            return new WP_Error( 'api_error', 'Proxy Unreachable', array( 'status' => 500 ) );
        }

        return rest_ensure_response( json_decode( wp_remote_retrieve_body( $response ), true ) );
    }
}



new Jubilee_Works_Studio();