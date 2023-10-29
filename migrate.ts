import dotenv from "dotenv";
import { BikeTagClient } from "biketag";
import { createWriteStream, existsSync, createReadStream } from "fs";
import { join, extname } from "path";
import axios from "axios";
import { uploadTagImagePayload } from "biketag/lib/common/payloads";
import { Client as GoogleMapsClient } from "@googlemaps/google-maps-services-js";
import { PlaceInputType } from "@googlemaps/google-maps-services-js/dist/common";
import { Game, Tag } from "biketag/lib/common/schema";

const googleMapsClient = new GoogleMapsClient({});

dotenv.config();
let startingNumber = parseInt(process.env.START ?? "0");
const limit = parseInt(process.env.LIMIT ?? "0");
const overWriteExistingTags = process.env.OVERWRITE === "true";
const doProperUpdate = !process.env.UPDATE || process.env.UPDATE === "true";
const downloadingImages = process.env.DOWNLOAD_IMAGES === "true";

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

const getBikeTagGPSLocation = async (tag: Tag, opts: any) => {
  let gps = undefined;
  await googleMapsClient
    .findPlaceFromText({
      params: {
        key: opts.googleApiKey,
        input: tag.foundLocation,
        inputtype: PlaceInputType.textQuery,
        fields: ["formatted_address", "name", "geometry"],
        locationbias: opts.boundary
          ? `circle:60660@${opts.boundary.lat},${opts.boundary.long}`
          : "",
      },
      timeout: 1000, // milliseconds
    })
    .then((r) => {
      const candidates = r.data.candidates;
      const chosenGeometry = candidates.length
        ? candidates[0]?.geometry?.location
        : null;
      gps = chosenGeometry;
    })
    .catch((e) => {
      console.log(
        e.response.data.error_message || `error ${e.response.status}`
      );
    });
  return gps;
};

function downloadBikeTagImages(tag: Tag): Promise<string>[] {
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

const opts = {
  game: process.env.BIKETAG_GAME ?? "test",
  imgur: {
    hash: process.env.BIKETAG_DESTINATION_IMGUR_HASH,
    clientId: process.env.IMGUR_CLIENT_ID,
    clientSecret: process.env.IMGUR_CLIENT_SECRET,
    accessToken: process.env.IMGUR_ACCESS_TOKEN,
    rapidApiKey: process.env.RAPID_API_KEY,
  },
  sanity: {
    useCdn: false,
    token: process.env.SANITY_ACCESS_TOKEN,
    projectId: process.env.SANITY_PROJECT_ID,
    dataset: process.env.SANITY_DATASET,
  },
  // reddit: {
  //   subreddit: process.env.REDDIT_SUBREDDIT ?? "cyclepdx",
  //   clientId: process.env.REDDIT_CLIENT_ID,
  //   clientSecret: process.env.REDDIT_CLIENT_SECRET,
  //   username: process.env.REDDIT_USERNAME,
  //   password: process.env.REDDIT_PASSWORD,
  // },
  googleApiKey: process.env.GOOGLE_API_KEY,
};

const biketag = new BikeTagClient(opts);

const migrateBikeTag = async (client: BikeTagClient) => {
  /// Get game data from the API
  const game = (await client.game(opts.game, { source: "sanity" })) as Game;

  if (!game) {
    return console.log("no game, no dice");
  }

  /// Set and get the new configuration using the mainhash from the game
  const config = client.config(
    {
      imgur: {
        hash: process.env.BIKETAG_DESTINATION_IMGUR_HASH ?? game.mainhash,
      },
      // reddit: {
      //   subreddit: game.subreddit,
      // }
    },
    false,
    true
  );
  const sourceOpts = {
    hash: process.env.BIKETAG_SOURCE_IMGUR_HASH,
  };
  const sourceName = game.mainhash

  const destinationTags = (await client.tags()) as Tag[];

  const getDestinationBikeTagByNumber = (tagnumber: number) => {
    const foundTags = destinationTags.filter((t) => t.tagnumber === tagnumber);
    if (foundTags.length) {
      return foundTags[0];
    }

    return null;
  };

  const tagsResponse = await client.getTags(sourceOpts, {
    source: process.env.BIKETAG_SOURCE ?? "imgur",
  });
  const sourceTags: Tag[] = tagsResponse.data.reverse();
  console.log({sourceTags})

  const getSourceBikeTagByNumber = (tagnumber: number) => {
    const foundTags = sourceTags.filter((t) => t?.tagnumber === tagnumber);
    if (foundTags.length) {
      return foundTags[0];
    }

    return null;
  };

  let updatePromises: Promise<any>[] = [];

  console.log({ game, config, tags: sourceTags.length }); // { source: 'imgur'}

  if (!sourceTags.length) {
    console.log("no tags to migrate");
  } else {
    startingNumber =
      startingNumber !== 0 ? startingNumber : sourceTags[0].tagnumber;
    const endingNumber =
      limit !== 0 ? startingNumber + limit : startingNumber + sourceTags.length;
    console.log(`migrating ${limit} tags from ${sourceName}`, { startingNumber, endingNumber, downloadingImages, overWriteExistingTags });
    for (
      let i = startingNumber, promiseCount = 1;
      i < endingNumber;
      ++i, promiseCount++
    ) {
      const tag:any = getSourceBikeTagByNumber(i);
      const existingTag = getDestinationBikeTagByNumber(i);

      let updateTag = true && doProperUpdate;

      if (!tag) { console.log('end of tags to process'); continue; }

      console.log({ retrieving: tag.tagnumber });
      tag.slug = tag.name =
        tag.slug?.indexOf(opts.game) === -1 && tag.slug?.indexOf("-") === 0
          ? `${opts.game}${tag.slug}`
          : tag.slug;
      tag.game = tag.game ?? opts.game;
      let imagePaths = [
        join(
          __dirname,
          tag.game,
          `BikeTag-${tag.game}-${tag.tagnumber}-found.jpg`
        ),
        join(
          __dirname,
          tag.game,
          `BikeTag-${tag.game}-${tag.tagnumber}-mystery.jpg`
        ),
      ];

      if (downloadingImages) {
        const downloadPromises = downloadBikeTagImages(tag);
        imagePaths = [];

        await Promise.all(downloadPromises).then(
          async (responses: string[]) => {
            imagePaths = responses;
          }
        );

        for (let imagePath of imagePaths) {
          if (
            imagePath.length &&
            existsSync(imagePath) &&
            (overWriteExistingTags || !existingTag)
          ) {
            const imageType =
              imagePath.indexOf("found") !== -1
                ? "found"
                : imagePath.indexOf("mystery") !== -1
                ? "mystery"
                : "";
            const image = await client.uploadTagImage(
              {
                tagnumber: tag.tagnumber,
                type: imageType,
                stream: createReadStream(imagePath),
              } as unknown as uploadTagImagePayload,
              { source: process.env.BIKETAG_DESTINATION ?? "sanity" }
            );

            if (image.success && image.data?.length) {
              const imageRef = image.data._id;

              if (imageType === "found") {
                console.log("successfully updated found tag image", imageRef);
                tag.foundImage = imageRef;
              } else {
                console.log("successfully updated mystery tag image", imageRef);
                tag.mysteryImage = imageRef;
              }
            } else {
              console.log("could not upload image", imageType, image);
            }
          } else if (overWriteExistingTags) {
            updateTag = false;
          }
        }
      }

      if (process.env.GET_GPS === "true") {
        const gps = await getBikeTagGPSLocation(tag, { ...opts, ...game });
        if (gps) {
          tag.gps = gps;
        }
      }

      if (!doProperUpdate) {
        console.log({ wouldUpdate: tag });
      }

      if (updateTag) {
        console.log({ updating: tag });

        updatePromises.push(
          client.updateTag(tag, {
            source: process.env.BIKETAG_DESTINATION ?? "sanity",
          })
        );

        if (promiseCount >= 15) {
          promiseCount = 0;
          await Promise.all(updatePromises);
        }
      }
    }
  }

  await Promise.all(updatePromises).then((updates: any) => {
    // console.log({ updates });
    for (const update of updates) {
      console.log(
        update.success ? "Success!" : "FAIL",
        update
      );
    }
  });
};

migrateBikeTag(biketag);
