import axios from "axios";
import { createWriteStream, existsSync, createReadStream } from "fs";
import { join, extname, resolve } from "path";
import { Game, Tag } from "biketag";


export const downloadBikeTagImages = (tag: Tag): Promise<string>[] => {
  const biketagImageFolder = join(__dirname, "images");
  const downloadPromises = [];

  if (!tag.foundImage && tag.foundImageUrl) {
    const ext = extname(tag.foundImageUrl);
    const originalImageUrl =
      tag.foundImageUrl.indexOf("imgur.com") !== -1
        ? tag.foundImageUrl.replace(ext, `l${ext}`)
        : tag.foundImageUrl;
    downloadPromises.push(
      downloadImage(
        originalImageUrl,
        join(
          biketagImageFolder,
          getBikeTagImageFileName(tag.game, "found", tag.tagnumber, ext)
        )
      )
    );
  } else {
    console.log({ noFoundTag: tag });
  }
  if (!tag.mysteryImage && tag.mysteryImageUrl) {
    const ext = extname(tag.mysteryImageUrl);
    const originalImageUrl =
      tag.mysteryImageUrl.indexOf("imgur.com") !== -1
        ? tag.mysteryImageUrl.replace(ext, `l${ext}`)
        : tag.mysteryImageUrl;
    downloadPromises.push(
      downloadImage(
        originalImageUrl,
        join(
          biketagImageFolder,
          getBikeTagImageFileName(tag.game, "mystery", tag.tagnumber, ext)
        )
      )
    );
  } else {
    console.log({ noMysteryTag: tag });
  }

  return downloadPromises;
}


function downloadImage(url: string, path: string): Promise<string> {
  if (existsSync(path)) {
    return Promise.resolve(path);
  }
  return new Promise(async (resolve, reject) => {
    const writer = createWriteStream(path);

    const response = await axios({
      url,
      method: "GET",
      responseType: "stream",
    });

    response.data.pipe(writer);
    writer.on("finish", () => {
      resolve(path);
    });
    writer.on("error", reject);
  });
}

const getBikeTagImageFileName = (
  game: string,
  type: "found" | "mystery",
  number: number,
  ext: string
) => {
  return `BikeTag-${game}-${number}-${type}${ext.replace("?1", "")}`;
};

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const normalizeLocationInput = (input: string): string => {
  let cleaned = input
    .replace(
      /\b([A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)?)\s+(?:and|at)\s+([A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)?)\b/gi,
      (match, p1, p2) => `${p1} & ${p2}`
    )
    .replace(/\s+/g, " ")
    .trim();

  // Try to bring numbered street to the front if applicable
  const parts = cleaned.split(" & ");
  if (parts.length === 2 && isNumberedStreet(parts[1]) && !isNumberedStreet(parts[0])) {
    cleaned = `${parts[1]} & ${parts[0]}`;
  }

  return cleaned;
};

export const isNumberedStreet = (str: string): boolean => {
  return /^\d{1,3}(st|nd|rd|th)?(?:\s+(Ave|Avenue|St|Street|Blvd|Way|Rd))?$/i.test(str.trim());
};

export const rateLimited = async <T>(fn: () => Promise<T>, minTime = 1100): Promise<T> => {
  const start = Date.now();
  const result = await fn();
  const elapsed = Date.now() - start;
  const wait = minTime - elapsed;
  if (wait > 0) await delay(wait);
  return result;
};