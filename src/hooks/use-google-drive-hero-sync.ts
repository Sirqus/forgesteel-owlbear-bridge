import { useEffect, useState } from 'react';
import { GoogleDriveHeroSync } from '@/services/sync/google-drive-hero-sync';

export function useGoogleDriveHeroSync() {
	const [ status, setStatus ] = useState(GoogleDriveHeroSync.getStatus());

	useEffect(() => {
		return GoogleDriveHeroSync.subscribe(setStatus);
	}, []);

	return {
		status,
		signIn: () => GoogleDriveHeroSync.signIn(),
		signOut: () => GoogleDriveHeroSync.signOut(),
		syncNow: () => GoogleDriveHeroSync.syncNow()
	};
}
