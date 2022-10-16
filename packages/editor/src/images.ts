/** Turns a local image into the URL stored on the board. */
export type ImageProvider = {
  /**
   * Store `file` and return the URL to keep on the image object.
   * A data URL and an https URL are both valid. The board does not care which.
   */
  upload(file: Blob): Promise<string>;
};

function readBlob(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image'));
    reader.readAsDataURL(file);
  });
}

/** Default provider. The image bytes live inside the document as a data URL. */
export function createDataUrlImageProvider(): ImageProvider {
  return {
    upload(file) {
      return readBlob(file);
    },
  };
}

export const dataUrlImageProvider = createDataUrlImageProvider();
