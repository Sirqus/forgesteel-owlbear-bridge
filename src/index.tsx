import { cleanupStaleServiceWorkers, isOwlbearBridgeMode, reloadAfterServiceWorkerCleanup } from '@/integrations/service-worker-cleanup';
import { DataLoader } from '@/components/panels/data-loader/data-loader';
import { DataManagerProvider } from './contexts/data-context';
import { ErrorBoundary } from '@/components/controls/error-boundary/error-boundary';
import { HashRouter } from 'react-router';
import { Main } from '@/components/main/main.tsx';
import { OwlbearBridge } from '@/integrations/owlbear-bridge';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initializeTheme } from '@/utils/initialize-theme';

import './index.scss';

initializeTheme();

// Register Service Worker for PWA functionality
if ('serviceWorker' in navigator) {
	window.addEventListener('load', () => {
		const bridgeMode = isOwlbearBridgeMode();

		cleanupStaleServiceWorkers({ includeCurrentScope: bridgeMode })
			.then(cleaned => {
				if (cleaned && reloadAfterServiceWorkerCleanup()) {
					return;
				}

				if (bridgeMode) {
					return;
				}

				return navigator.serviceWorker.register(
					`${import.meta.env.BASE_URL}sw.js`,
					{ scope: import.meta.env.BASE_URL }
				);
			})
			.catch(error => {
				console.error('SW registration failed: ', error);
			});
	});
}

const root = createRoot(document.getElementById('root')!);
root.render(
	<ErrorBoundary>
		<StrictMode>
			<DataLoader
				onComplete={data => {
					root.render(
						<ErrorBoundary>
							<StrictMode>
								<HashRouter>
									<DataManagerProvider
										dataService={data.service}
										initialOptions={data.options}
										initialSession={data.session}
										initialHeroes={data.heroes}
										initialHomebrewSourcebooks={data.homebrewSourcebooks}
										initialHiddenSourcebookIDs={data.hiddenSourcebookIDs}
									>
										<Main
											connectionSettings={data.connectionSettings}
											dataService={data.service}
										/>
									</DataManagerProvider>
								</HashRouter>
							</StrictMode>
						</ErrorBoundary>
					);
					OwlbearBridge.sendReady();
				}}
			/>
		</StrictMode>
	</ErrorBoundary>
);
