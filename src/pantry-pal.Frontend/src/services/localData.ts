/** Removes everything this app stored on the device for the signed-in user. */
export async function clearLocalData(): Promise<void> {
  localStorage.clear();
  sessionStorage.clear();
  // `indexedDB.databases()` is missing in some browsers; skip rather than fail there.
  if (typeof indexedDB.databases === 'function') {
    const databases = await indexedDB.databases();
    await Promise.all(
      databases
        .filter((db): db is IDBDatabaseInfo & { name: string } => !!db.name)
        .map(
          (db) =>
            new Promise<void>((resolve, reject) => {
              const request = indexedDB.deleteDatabase(db.name);
              request.onsuccess = () => resolve();
              request.onerror = () => reject(request.error);
              request.onblocked = () =>
                reject(new Error(`Database ${db.name} is in use`));
            }),
        ),
    );
  }
}
