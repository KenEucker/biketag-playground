import dotenv from "dotenv";
import { BikeTagClient } from "biketag";
import { Game, Tag } from "biketag/lib/common/schema";


dotenv.config();
let startingNumber = parseInt(process.env.START ?? "0");
const limit = parseInt(process.env.LIMIT ?? "0");
const overWriteExistingTags = process.env.OVERWRITE === "true";

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
  googleApiKey: process.env.GOOGLE_API_KEY,
};

const biketag = new BikeTagClient(opts);

const deMigrateBikeTag = async (client: BikeTagClient) => {
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

  const getDestinationBikeTagsByNumber = (tagnumber: number) => {
    console.log({destinationTags})
    const foundTags = destinationTags.filter((t) => t?.tagnumber === tagnumber);
    if (foundTags.length) {
      return foundTags;
    }

    return null;
  };

  const tagsResponse = await client.getTags(sourceOpts, {
    source: process.env.BIKETAG_SOURCE ?? "imgur",
  });
  const sourceTags: Tag[] = tagsResponse.data.reverse();

  const getSourceBikeTagByNumber = (tagnumber: number) => {
    const foundTags = sourceTags.filter((t) => t.tagnumber === tagnumber);
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
    console.log(`migrating ${limit} tags from ${sourceName}`, { startingNumber, endingNumber, overWriteExistingTags });
    for (
      let i = startingNumber, promiseCount = 1;
      i < endingNumber;
      ++i, promiseCount++
    ) {
      const tag:any = getSourceBikeTagByNumber(i);
      const existingTags = getDestinationBikeTagsByNumber(i);
      let tagToDelete
      console.log({tag, existingTags})

      let deleteTag = false && overWriteExistingTags;

      if (!tag) { console.log('end of tags to process'); continue; }

      console.log({ comparing: tag.tagnumber });
      tagToDelete = existingTags[0]
      

      if (!overWriteExistingTags) {
        console.log({ wouldDelete: tagToDelete });
      }

      if (deleteTag) {
        console.log({ deleting: tag });

        // updatePromises.push(
        //   client.updateTag(tag, {
        //     source: process.env.BIKETAG_DESTINATION ?? "sanity",
        //   })
        // );

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

deMigrateBikeTag(biketag);
