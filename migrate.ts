import dotenv from "dotenv";
import { BikeTagClient } from "biketag";
import { readFileSync } from "fs";
import { Client as GoogleMapsClient } from "@googlemaps/google-maps-services-js";
import { PlaceInputType } from "@googlemaps/google-maps-services-js/dist/common";
import { Game, Tag } from "biketag";
import { helpers } from "biketag";
import { resolve } from "path";
import { delay, normalizeLocationInput } from "./helpers";
import axios from "axios";

const googleMapsClient = new GoogleMapsClient({});

dotenv.config();
let startingNumber = parseInt(process.env.START ?? "0");
const gameName = process.env.BIKETAG_GAME;
const limit = parseInt(process.env.LIMIT ?? "0");
const dryRun = process.env.DRY_RUN === "true";
const migrateFromFile = process.env.MIGRATE_INPUT_FILE;
const migrateFromFileGame = process.env.MIGRATE_GAME ?? gameName;
const doResizeOnUpload = process.env.RESIZE_AND_VARIANTS === "true";
const fromSource = process.env.BIKETAG_SOURCE ?? "imgur";
const toSource = process.env.BIKETAG_DESTINATION ?? "aws";
const delayMs = !Number.isNaN(parseInt(process.env.UPLOAD_DELAY))
  ? parseInt(process.env.UPLOAD_DELAY)
  : 200;
const getGps = process.env.GET_GPS_ON_UPLOAD === "true";
const googleApiKey = process.env.GOOGLE_API_KEY;

const getBikeTagGPSLocation2 = async (tag: Tag, opts: any) => {
  const cityContext = opts.region?.zipcode ? `${opts.region.description} ${opts.region.zipcode}` : opts.region?.description;

  const rawInput = (tag.foundLocation ?? "").trim();
  if (!rawInput) {
    console.warn("✗ Skipping GPS lookup: empty foundLocation.");
    return undefined;
  }

  const normalizedInput = normalizeLocationInput(rawInput);
  const fullQuery = `${normalizedInput}, ${cityContext}`.trim();

  try {
    console.log('trying to get gps coordinates for', fullQuery)
    const boundary = `${opts.boundary.lat},${opts.boundary.lng}`
    const response = await axios.get("https://maps.googleapis.com/maps/api/geocode/json", {
      params: {
        key: googleApiKey,
        address: fullQuery,
        ...(opts.boundary && {
          location: boundary,
          radius: 1000,
        }),
      },
      timeout: 1000,
    });

    const result = response.data.results?.[0];
    const location = result?.geometry?.location;

    if (location?.lat !== undefined && location?.lng !== undefined) {
      return { lat: location.lat, long: location.lng, alt: 0 };
    }

    console.warn(`⚠ Geocoding API did not return location for "${fullQuery}"`);
  } catch (e: any) {
    console.error(
      `✗ Geocoding API error for "${rawInput}":`,
      e?.response?.data?.error_message || `status ${e?.response?.status}`
    );
  }

  return undefined;
};


const getBikeTagGPSLocation = async (tag: Tag, opts: any) => {
  const cityContext = opts.region?.zipcode ? `${opts.region.description} ${opts.region.zipcode}` : opts.region?.description;
  const rawInput = (tag.foundLocation ?? "").trim();
  if (!rawInput) {
    console.warn("✗ Skipping GPS lookup: empty foundLocation.");
    return undefined;
  }

  const normalizedInput = normalizeLocationInput(rawInput);
  const locationbias = opts.boundary
    ? `point:${opts.boundary.lat},${opts.boundary.lng}`
    : "";

  const fullQuery = `${normalizedInput} ${cityContext}`
  const tryLookup = async (input: string) => {
    console.log(`→ Trying GPS lookup for: "${input}"`);
    try {
      const r = await googleMapsClient.findPlaceFromText({
        params: {
          key: googleApiKey,
          input,
          inputtype: PlaceInputType.textQuery,
          fields: ["formatted_address", "name", "geometry"],
          locationbias,
        },
        timeout: 1000,
      });

      const candidates = r.data?.candidates ?? [];
      const location = candidates[0]?.geometry?.location;

      if (location?.lat !== undefined && location?.lng !== undefined) {
        return { lat: location.lat, long: location.lng, alt: 0 };
      }

      return null;
    } catch (e: any) {
      console.error(
        `✗ Google API error for "${input}":`,
        e?.response?.data?.error_message || `status ${e?.response?.status}`
      );
      return null;
    }
  };

  const result = await tryLookup(fullQuery);
  if (result) {
    return result;
  }

  console.warn(`⚠ No GPS match found for tag ${tag.tagnumber} with input: "${rawInput}"`);
  return undefined;
};



if (!gameName?.length) {
  console.log("no game, no dice");
  process.exit();
}

const opts = {
  game: gameName,
  imgur: {
    hash: process.env.BIKETAG_DESTINATION_IMGUR_HASH,
    clientId: process.env.IMGUR_CLIENT_ID ?? process.env.I_CID,
    clientSecret: process.env.IMGUR_CLIENT_SECRET,
    accessToken: process.env.IMGUR_ACCESS_TOKEN,
    rapidApiKey: process.env.RAPID_API_KEY ?? process.env.RA_FE_KEY,
  },
  sanity: {
    useCdn: false,
    token: process.env.SANITY_ACCESS_TOKEN,
    projectId: process.env.SANITY_PROJECT_ID,
    dataset: process.env.SANITY_DATASET,
  },
  aws: {
    accessKeyId: process.env.S3_AID ?? process.env.S3_ACCESS_ID ?? null,
    secretAccessKey: process.env.S3_AKEY ?? process.env.S3_ACCESS_KEY ?? null,
    region: "",
  },
  // reddit: {
  //   subreddit: process.env.REDDIT_SUBREDDIT ?? "cyclepdx",
  //   clientId: process.env.REDDIT_CLIENT_ID,
  //   clientSecret: process.env.REDDIT_CLIENT_SECRET,
  //   username: process.env.REDDIT_USERNAME,
  //   password: process.env.REDDIT_PASSWORD,
  // },
};

const biketag = new BikeTagClient(opts);

export const migrateTags = async (
  client: BikeTagClient,
  {
    fromSource,
    toSource,
    gameName,
    limit = 0,
    getGps = false,
    startingNumber = 0,
    opts = {},
    delayMs = 0,
    dryRun = false,
  }: {
    fromSource: string;
    toSource: string;
    gameName: string;
    limit?: number;
    getGps?: boolean;
    startingNumber?: number;
    opts?: any;
    delayMs?: number;
    dryRun?: boolean;
  }
) => {
  const game = (await client.game(migrateFromFileGame, {
    source: "sanity",
  })) as Game;

  console.log("Loaded game config:", game);

  const sourceTagsResponse =  (
    await client.getTags({ game: gameName }, { source: fromSource })
  );

  if (!sourceTagsResponse.data?.length) {
    console.log(`No tags found in source: ${fromSource}`);
    return;
  }

  const sourceTags = sourceTagsResponse.data

  let tags = sourceTags
    .filter((tag) => typeof tag?.tagnumber === "number")
    .filter((tag) => tag.tagnumber >= startingNumber)
    .sort((a, b) => a.tagnumber - b.tagnumber);

  if (limit > 0) {
    console.log(
      `Limiting to first ${limit} tags after startingNumber ${startingNumber}`
    );
    tags = tags.slice(0, limit);
  }

  console.log(
    `Starting ${dryRun ? "dry run" : "real"} migration of ${
      tags.length
    } tags from ${fromSource} → ${toSource}`
  );

  let successCount = 0;
  let failCount = 0;
  

  if (toSource === 'aws') {
    client.config(
    {
      aws: {
        region: game.awsRegion,
      },
    },
    false,
    true);
  }

  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    tag.game = tag.game ?? gameName;
    tag.slug = tag.slug ?? tag.name ?? `${gameName}-tag-${tag.tagnumber}`;

    console.log(`[${i + 1}/${tags.length}] Processing tag #${tag.tagnumber}`);

    if (
      getGps &&
      (!tag.gps || (tag.gps.lat === 0 || tag.gps.long === 0)) &&
      tag.foundLocation
    ) {
      const gps = await getBikeTagGPSLocation(tag, game);
      if (gps) {
        tag.gps = gps;
        console.log(`→ Added GPS to tag ${tag.tagnumber}:`, gps);
      } else {
        console.warn(`→ Could not determine GPS for tag ${tag.tagnumber}`);
      }
    }

    if (dryRun) {
      console.log(`→ Would update tag ${tag.tagnumber}:`, tag);
    } else {
      try {
        const res = 
          await client.updateTag(
            { ...tag, resize: doResizeOnUpload },
            { source: toSource }
          );
        if (res.success) {
          console.log(`✓ Updated tag ${tag.tagnumber} → ${toSource}`);
          successCount++;
        } else {
          console.error(`✗ Failed to update tag ${tag.tagnumber}`, res.error);
          failCount++;
        }
      } catch (err) {
        console.error(`✗ Exception during tag update ${tag.tagnumber}`, err);
        failCount++;
      }
    }

    if (delayMs > 0) {
      await delay(delayMs);
    }
  }

  console.log(
    `\n✅ Migration complete (${
      dryRun ? "dry run" : "real"
    }): ${successCount} succeeded, ${failCount} failed.`
  );
};

/// Requires a special build of the biketag API to export the imgur helpers
const migrateFromImgurAlbumFile = async (
  client: BikeTagClient,
  {
    gameName,
    migrateFromFile,
    migrateFromFileGame,
    dryRun = false,
    doResizeOnUpload = false,
    delayMs = 0,
    getGps = false,
    startingNumber = 0,
    limit = 0,
    opts = {},
  }: {
    gameName: string;
    migrateFromFile: string;
    migrateFromFileGame: string;
    dryRun?: boolean;
    doResizeOnUpload?: boolean;
    delayMs?: number;
    getGps?: boolean;
    startingNumber?: number;
    limit?: number;
    opts?: any;
  }
) => {
  const game = (await client.game(
    { game: gameName },
    {
      source: "sanity",
    }
  )) as Game;

  if (game.slug !== gameName) {
    console.warn("⚠ Game name mismatch", { game, expected: gameName });
  }

  console.log("Loaded game config:", game);

  const config = client.config(
    {
      aws: {
        region: game.awsRegion,
      },
    },
    false,
    true
  );

  console.log("Using AWS config:", config);

  const inputPath = resolve(__dirname, "input", migrateFromFile);
  const fileContent = readFileSync(inputPath);
  const albumInfo = JSON.parse(fileContent.toString());

  const albumImages = albumInfo.data?.images ?? [];
  const images = helpers.getGroupedImagesByTagnumber(albumImages);
  const allTags = helpers.getGroupedTagsByTagnumber(images, {
    game: migrateFromFileGame,
  });

  let tags = allTags
    .filter((tag) => typeof tag?.tagnumber === "number")
    .filter((tag) => tag.tagnumber >= startingNumber)
    .sort((a, b) => a.tagnumber - b.tagnumber);

  if (limit > 0) {
    console.log(
      `Limiting to first ${limit} tags after startingNumber ${startingNumber}`
    );
    tags = tags.slice(0, limit);
  }

  console.log(
    `Beginning ${dryRun ? "dry run" : "actual"} migration of ${
      tags.length
    } tags from file ${migrateFromFile}, starting at tag #${startingNumber}`
  );

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < tags.length; ++i) {
    const tag = tags[i];

    if (
      getGps &&
      (!tag.gps || tag.gps.lat === 0 || tag.gps.long === 0) &&
      tag.foundLocation
    ) {
      const gps = await getBikeTagGPSLocation(tag, game);
      if (gps) {
        tag.gps = gps;
        console.log(`→ Added GPS to tag ${tag.tagnumber}:`, gps);
      } else {
        console.warn(`→ Could not determine GPS for tag ${tag.tagnumber}`);
      }
    }

    if (!dryRun) {
      console.log(`→ [${i + 1}/${tags.length}] Updating tag:`, tag);
      try {
        await client.updateTag(
          { ...tag, resize: doResizeOnUpload },
          { source: toSource }
        );
        console.log(`✓ Successfully updated tag ${tag.slug}`);
        successCount++;
      } catch (err) {
        console.error(`✗ Failed to update tag ${tag.slug}`, err);
        failCount++;
      }
    } else {
      console.log(`→ [${i + 1}/${tags.length}] Would update tag:`, tag);
    }

    if (delayMs > 0) {
      await delay(delayMs);
    }
  }

  console.log(
    `\n🟢 Completed ${dryRun ? "dry run" : "real"} migration of ${
      tags.length
    } tags (✓ ${successCount}, ✗ ${failCount})`
  );
};

if (migrateFromFile?.length) {
  migrateFromImgurAlbumFile(biketag, {
    gameName,
    migrateFromFile,
    migrateFromFileGame,
    doResizeOnUpload,
    dryRun,
    delayMs,
    limit,
    opts,
    getGps,
    startingNumber,
  });
} else {
  migrateTags(biketag, {
    fromSource,
    toSource,
    gameName,
    dryRun,
    limit,
    getGps,
    startingNumber,
    opts,
    delayMs,
  });
}
