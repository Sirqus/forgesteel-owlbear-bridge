import { Plugin, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

declare const process: {
	env: Record<string, string | undefined>;
};

const BASE_PATH = normalizeBasePath(process.env.VITE_BASE_PATH ?? '/');

// Base manifest template
const getBaseManifest = () => {
	return {
		name: 'Forge Steel',
		short_name: 'Forge Steel',
		description: 'Heroes, monsters, encounters ... everything you need for Draw Steel.',
		start_url: BASE_PATH,
		display: 'standalone',
		background_color: '#ffffff',
		theme_color: '#1890ff',
		orientation: 'any',
		scope: BASE_PATH,
		categories: [ 'games', 'entertainment', 'utilities' ],
		lang: 'en',
		dir: 'ltr'
	};
};

// Generate manifest with icon paths
const generateManifest = (shieldIconPath?: string) => {
	const iconPath = shieldIconPath || withBasePath('src/assets/shield.png');

	return {
		...getBaseManifest(),
		icons: [
			{
				src: iconPath,
				sizes: '192x192',
				type: 'image/png',
				purpose: 'any maskable'
			},
			{
				src: iconPath,
				sizes: '512x512',
				type: 'image/png',
				purpose: 'any maskable'
			}
		]
	};
};

const manifestPlugin = (): Plugin => {
	return {
		name: 'manifest-plugin',
		generateBundle(_, bundle) {
			// Find the shield icon in the bundle
			const shieldIcon = Object.keys(bundle).find(
				key => key.includes('shield') && key.endsWith('.png')
			);

			if (shieldIcon) {
				const manifest = generateManifest(withBasePath(shieldIcon));

				// Write the manifest to the dist folder
				this.emitFile({
					type: 'asset',
					fileName: 'manifest.json',
					source: JSON.stringify(manifest, null, 2)
				});
			}
		}
	};
};

// https://vitejs.dev/config/
export default defineConfig({
	base: BASE_PATH,
	build: {
		chunkSizeWarningLimit: 10000,
		rollupOptions: {
			input: {
				main: './index.html',
				sw: './src/sw.ts'
			},
			output: {
				entryFileNames: chunkInfo => {
					return chunkInfo.name === 'sw' ? 'sw.js' : '[name]-[hash].js';
				},
				assetFileNames: chunkInfo => {
					if (chunkInfo.names && chunkInfo.names[0].match(/\.(ttf|otf)$/)) {
						return 'assets/[name][extname]';
					}
					return 'assets/[name]-[hash][extname]';
				}
			}
		}
	},
	plugins: [
		react(),
		manifestPlugin(),
		// Dev server plugin to serve manifest.json and sw.js
		{
			name: 'dev-pwa-files',
			configureServer(server) {
				// Serve manifest.json during development
				server.middlewares.use('/manifest.json', (_, res) => {
					const manifest = generateManifest();
					res.setHeader('Content-Type', 'application/json');
					res.end(JSON.stringify(manifest, null, 2));
				});

				// Serve sw.js during development (compiled on-the-fly)
				server.middlewares.use('/sw.js', async (_, res) => {
					try {
						// Import and compile the service worker
						const { build } = await import('esbuild');
						const result = await build({
							entryPoints: [ 'src/sw.ts' ],
							bundle: true,
							write: false,
							format: 'iife',
							target: 'es2020',
							minify: false
						});

						const swCode = result.outputFiles[0].text;
						res.setHeader('Content-Type', 'application/javascript');
						res.end(swCode);
					} catch (error) {
						console.error('Error compiling service worker:', error);
						res.statusCode = 500;
						res.end('Error compiling service worker');
					}
				});
			}
		}
	],
	publicDir: 'public',
	resolve: {
		tsconfigPaths: true
	},
	server: {
		headers: {
			'Service-Worker-Allowed': BASE_PATH
		}
	}
});

function normalizeBasePath(path: string): string {
	if (!path || path === '/') {
		return '/';
	}

	return `/${path.replace(/^\/+|\/+$/g, '')}/`;
}

function withBasePath(path: string): string {
	return `${BASE_PATH}${path.replace(/^\/+/g, '')}`;
}
