interface StorageBridge { getLocalStorage(key: string): Promise<string>; setLocalStorage(key: string, value: string): Promise<boolean> }
/** Auth writes must finish before pairing succeeds or sign-out is reported. */
export function deviceAuthStorage(getBridge: () => Promise<StorageBridge>) {
  let pending = Promise.resolve();
  const write = (key: string, value: string) => {
    const operation = pending.catch(() => {}).then(async () => {
      const saved = await (await getBridge()).setLocalStorage(key, value);
      if (!saved) throw new Error('Could not save your account on this device. Please try again.');
    });
    pending = operation;
    return operation;
  };
  return {
    async getItem(key: string) { await pending.catch(() => {}); return (await (await getBridge()).getLocalStorage(key)) || null; },
    setItem: write,
    removeItem(key: string) { return write(key, ''); },
  };
}
