
import dotenv from 'dotenv'
import { BikeTagClient, createTagObject } from 'biketag'
import { Tag } from 'biketag/lib/common/types'
import { join } from 'path'
import Papa from 'papaparse'
import { writeFileSync } from 'fs'

dotenv.config()

const sleep = (s: number) => new Promise((r) => setTimeout(r, s))

const opts = {
    game: process.env.BIKETAG_GAME ?? 'portland',
    imgur: {
      clientId: process.env.IMGUR_CLIENT_ID,
      clientSecret: process.env.IMGUR_CLIENT_SECRET,
      accessToken: process.env.IMGUR_ACCESS_TOKEN,
      hash: process.env.IMGUR_HASH,
    },
    sanity: {
      useCdn: false,
      token: process.env.SANITY_ACCESS_TOKEN,
      projectId: process.env.SANITY_PROJECT_ID,
      dataset: process.env.SANITY_DATASET,
    },
    reddit: {
      subreddit: process.env.REDDIT_SUBREDDIT ? process.env.REDDIT_SUBREDDIT : 'cyclepdx',
      clientId: process.env.REDDIT_CLIENT_ID,
      clientSecret: process.env.REDDIT_CLIENT_SECRET,
      username: process.env.REDDIT_USERNAME,
      password: process.env.REDDIT_PASSWORD,
    },
    googleApiKey: process.env.GOOGLE_API_KEY,
}

const biketag = new BikeTagClient(opts)
  
const exportBikeTags = async (client: BikeTagClient) => {
  const {data: game} = await client.game(opts.game)

  if (!game) {
    return console.log('no game, no dice')
  }

  const {data: tags} = await client.tags()
  const exportString = Papa.unparse(tags)
  const exportFilePath = join(process.cwd(), 'files', process.env.EXPORT_FILE ?? `${opts.game}-export.csv`)

  console.log({tags, exportFilePath, exportString})

  writeFileSync(exportFilePath, exportString)
}
  
  exportBikeTags(biketag)