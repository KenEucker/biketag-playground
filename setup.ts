import {
  S3Client,
  CreateBucketCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { BikeTagClient, BikeTagConfiguration, Region } from "biketag";
import dotenv from "dotenv";
import { delay, rateLimited } from "./helpers";
dotenv.config();

const DO_REGIONS = {
  nyc3: { lat: 40.7128, lng: -74.006 },
  sfo3: { lat: 37.7749, lng: -122.4194 },
  ams3: { lat: 52.3676, lng: 4.9041 },
  sgp1: { lat: 1.3521, lng: 103.8198 },
  tor1: { lat: 43.6532, lng: -79.3832 },
  fra1: { lat: 50.1109, lng: 8.6821 },
};

const haversineDistance = (a: any, b: any) => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const aHarv =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return R * 2 * Math.atan2(Math.sqrt(aHarv), Math.sqrt(1 - aHarv));
};

const getLatLngFromZip = async (zip: string) => {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${zip}&limit=1`,
      {
        headers: {
          "User-Agent": "BikeTag/1.0 (hello@biketag.org)",
        },
      }
    );
    const data = await res.json();
    if (!data.length) throw new Error(`Unable to geocode: ${zip}`);
    return {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
    };
  } catch (err: any) {
    console.error(
      `❌ Error in getLatLngFromZip for "${zip}": ${err.message || err}`
    );
    throw err;
  }
};

const findClosestRegion = async (game: any) => {
  try {
    let coords;

    if (
      game.boundary &&
      typeof game.boundary.lat === "number" &&
      typeof game.boundary.lng === "number"
    ) {
      coords = { lat: game.boundary.lat, lng: game.boundary.lng };
      console.log(`📍 Using boundary coordinates for "${game.name}":`, coords);
    } else {
      const regionSearch = `${game.region.description} ${game.region.zipcode}`;
      coords = await getLatLngFromZip(regionSearch);
      console.log(`🌐 Fallback to geocoding for "${game.name}":`, coords);
    }

    let bestRegion = "nyc3";
    let minDistance = Infinity;
    for (const [regionKey, loc] of Object.entries(DO_REGIONS)) {
      const dist = haversineDistance(coords, loc);
      if (dist < minDistance) {
        minDistance = dist;
        bestRegion = regionKey;
      }
    }
    console.log(`Closest DO region for "${game.name}" is ${bestRegion}`);
    return bestRegion;
  } catch (err: any) {
    console.error(
      `❌ Error in findClosestRegion for "${game.name}": ${err.message || err}`
    );
    throw err;
  }
};

const bucketExists = async (client: S3Client, bucket: string) => {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch (err: any) {
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      return false;
    }
    console.error(
      `❌ Error checking if bucket "${bucket}" exists: ${err.message || err}`
    );
    throw err;
  }
};

const createBucket = async (client: S3Client, bucket: string) => {
  console.log(`Creating bucket: ${bucket}`);
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`✅ Bucket "${bucket}" created.`);
  } catch (err: any) {
    if (err.name === "BucketAlreadyOwnedByYou") {
      console.log(`ℹ️ Bucket "${bucket}" already exists (owned by you).`);
    } else {
      console.error(
        `❌ Failed to create bucket "${bucket}": ${err.message || err}`
      );
      throw err;
    }
  }
};

const setCors = async (client: S3Client, bucket: string) => {
  try {
    console.log(`Applying CORS policy...`);
    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedHeaders: ["*"],
              AllowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"],
              AllowedOrigins: ["*"],
              ExposeHeaders: ["x-amz-meta-title", "x-amz-meta-description"],
              MaxAgeSeconds: 3000,
            },
          ],
        },
      })
    );
    console.log(`✅ CORS policy applied.`);
  } catch (err: any) {
    console.error(
      `❌ Failed to set CORS for bucket "${bucket}": ${err.message || err}`
    );
    throw err;
  }
};

const createFolder = async (
  client: S3Client,
  bucket: string,
  folder: string
) => {
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `${folder}/`,
      })
    );
    console.log(`✅ Folder "${folder}/" created.`);
  } catch (err: any) {
    console.error(
      `❌ Failed to create folder "${folder}/" in bucket "${bucket}": ${
        err.message || err
      }`
    );
    throw err;
  }
};

export const runSetupForGame = async (
  biketagClient: BikeTagClient,
  game?: any
): Promise<boolean> => {
  try {
    if (typeof game === "string") {
      const gamesResponse = await biketagClient.getGame(
        { game },
        { source: "sanity" }
      );
      if (gamesResponse.success) {
        game = gamesResponse.data;
      } else {
        throw new Error("game could not be retrieved: " + gamesResponse.error);
      }
    }

    if (!game.settings['queue::autoPost']) {
      console.log(`🔹 "${game.name}" does not have autopost set, skipping: ${game.awsRegion}`);
      return false;
    }

    if (game.awsRegion) {
      console.log(`✅ "${game.name}" already has awsRegion: ${game.awsRegion}`);
      return false;
    }

    const awsRegion = await findClosestRegion(game);
    const bucket = `${game.slug}-biketag`;

    const client = new S3Client({
      region: awsRegion,
      endpoint: `https://${awsRegion}.digitaloceanspaces.com`,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_ID!,
        secretAccessKey: process.env.S3_ACCESS_KEY!,
      },
    });

    const exists = await bucketExists(client, bucket);
    if (exists) {
      console.log(
        `✅ Bucket "${bucket}" already exists, skipping setup for "${game.name}".`
      );
      return false;
    }

    console.log(`🔧 Starting setup for game:`, game);

    await createBucket(client, bucket);
    await setCors(client, bucket);
    for (const folder of ["main", "queue", "archive"]) {
      await createFolder(client, bucket, folder);
    }

    game.awsRegion = awsRegion;
    const updateResponse = await biketagClient.updateGame(game, {
      source: "sanity",
    });
    if (updateResponse.success) {
      console.log(
        `✅ Game "${game.name}" updated with awsRegion: ${awsRegion}`
      );
    } else {
      console.error(
        `❌ Failed to update game "${game.name}": ${updateResponse.error}`
      );
    }

    return true;
  } catch (err: any) {
    console.error(
      `❌ Error setting up game "${game?.name || game}": ${err.message || err}`
    );
    throw err;
  }
};

export const runSetupForAllGames = async (biketagClient: BikeTagClient) => {
  if (!process.env.S3_ACCESS_ID || !process.env.S3_ACCESS_KEY) {
    throw new Error("Missing S3_ACCESS_ID or S3_ACCESS_KEY in env");
  }

  console.log(`🔍 Fetching all games from Sanity...`);
  const gamesResponse = await biketagClient.getAllGames(undefined, {
    source: "sanity",
  });
  if (!gamesResponse.success) {
    throw new Error("Failed to fetch games from Sanity");
  }

  const games = gamesResponse.data;
  console.log(`Found ${games.length} games.`);

  const maxGames = process.env.MAX_GAMES
    ? parseInt(process.env.MAX_GAMES)
    : Infinity;
  let processed = 0;

  for (const game of games) {
    if (processed >= maxGames) {
      console.log(`ℹ️ Reached MAX_GAMES limit (${maxGames}). Stopping.`);
      break;
    }

    try {
      let didProcess = false;
      if (process.env.DRY_RUN === "true") {
        console.log(`📝 DRY RUN: Would set up "${game.name}"`);
        didProcess = true;
      } else {
        didProcess = await rateLimited(
          () => runSetupForGame(biketagClient, game),
          1100
        );
      }

      if (didProcess) {
        processed++;
      }
    } catch (err: any) {
      console.error(
        `❌ Error running setup for "${game.name}": ${err.message || err}`
      );
    }
  }

  console.log(`🎉 Completed setup for ${processed} game(s).`);
};

const opts = {
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
};

const biketag = new BikeTagClient(opts as BikeTagConfiguration);

if (process.env.SETUP_ALL_GAMES === "true") {
  runSetupForAllGames(biketag);
} else if (process.env.SETUP_GAME) {
  if (!process.env.S3_ACCESS_ID || !process.env.S3_ACCESS_KEY) {
    throw new Error("Missing S3_ACCESS_ID or S3_ACCESS_KEY in env");
  }
  runSetupForGame(biketag, process.env.SETUP_GAME);
}
