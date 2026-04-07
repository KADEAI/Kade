const preloadPromises = new Map<string, Promise<void>>();

export const preloadImageUri = (uri?: string) => {
  const normalizedUri = uri?.trim();

  if (!normalizedUri) {
    return Promise.resolve();
  }

  const existingPromise = preloadPromises.get(normalizedUri);
  if (existingPromise) {
    return existingPromise;
  }

  const preloadPromise = new Promise<void>((resolve) => {
    const image = new Image();

    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
    };

    image.onload = () => {
      const decodePromise =
        typeof image.decode === "function" ? image.decode() : Promise.resolve();

      decodePromise.catch(() => undefined).finally(() => {
        cleanup();
        resolve();
      });
    };

    image.onerror = () => {
      cleanup();
      preloadPromises.delete(normalizedUri);
      resolve();
    };

    image.decoding = "async";
    image.src = normalizedUri;
  });

  preloadPromises.set(normalizedUri, preloadPromise);
  return preloadPromise;
};
