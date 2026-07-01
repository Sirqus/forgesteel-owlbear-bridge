import { Alert, Button, Popover, Space, Tag } from 'antd';
import { CloudOutlined, CloudSyncOutlined, ExclamationCircleOutlined, LoginOutlined } from '@ant-design/icons';
import { ErrorBoundary } from '@/components/controls/error-boundary/error-boundary';
import { useGoogleDriveHeroSync } from '@/hooks/use-google-drive-hero-sync';

import './google-drive-sync-status.scss';

export const GoogleDriveSyncStatus = () => {
	const {
		status,
		signIn,
		signOut,
		syncNow
	} = useGoogleDriveHeroSync();

	const isConfigured = status.kind !== 'unconfigured';
	const isSignedIn = [ 'syncing', 'synced', 'offline', 'error' ].includes(status.kind);
	const isBusy = status.kind === 'signing-in' || status.kind === 'syncing';

	const content = (
		<Space orientation='vertical' className='google-drive-sync-popover'>
			<div>
				<b>Google Drive Sync</b>
				<div className='sync-message'>{status.message}</div>
			</div>
			{
				status.kind === 'unconfigured' ?
					<Alert
						type='info'
						showIcon={true}
						title='Set VITE_GOOGLE_CLIENT_ID to enable Google Drive character sync.'
					/>
					: null
			}
			{
				status.lastSyncedAt ?
					<div className='sync-message'>
						Last synced {new Date(status.lastSyncedAt).toLocaleTimeString()}
					</div>
					: null
			}
			<Space>
				<Button
					size='small'
					type='primary'
					icon={<LoginOutlined />}
					disabled={!isConfigured || isBusy}
					onClick={() => void signIn()}
				>
					Sign in
				</Button>
				<Button
					size='small'
					disabled={!isSignedIn || isBusy}
					onClick={() => void syncNow()}
				>
					Sync now
				</Button>
				<Button
					size='small'
					disabled={!isSignedIn || isBusy}
					onClick={signOut}
				>
					Sign out
				</Button>
			</Space>
		</Space>
	);

	return (
		<ErrorBoundary>
			<Popover content={content} trigger='click' placement='topRight'>
				<Button
					type='text'
					className={`google-drive-sync-status google-drive-sync-${status.kind}`}
					icon={getIcon(status.kind)}
					title={status.message}
				>
					{
						status.pendingChanges ?
							<Tag color='blue'>Sync</Tag>
							: null
					}
				</Button>
			</Popover>
		</ErrorBoundary>
	);
};

function getIcon(kind: string) {
	switch (kind) {
		case 'signing-in':
		case 'syncing':
			return <CloudSyncOutlined spin={true} />;
		case 'error':
		case 'offline':
		case 'unconfigured':
			return <ExclamationCircleOutlined />;
		default:
			return <CloudOutlined />;
	}
}
