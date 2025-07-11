import dotenv from "dotenv";
dotenv.config();

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, basename, extname } from "path";

export const sortTagsJson = (inputFile: string, outputFile?: string) => {
  try {
    const inputPath = resolve(__dirname, "input", inputFile);
    if (!existsSync(inputPath)) {
      console.error(`❌ Input file not found: ${inputPath}`);
      return;
    }

    if (!outputFile) {
      const base = basename(inputFile, extname(inputFile));
      const ext = extname(inputFile);
      outputFile = `${base}--sorted${ext}`;
    }

    const outputPath = resolve(__dirname, "input", outputFile);
    console.log(`🔍 Reading input file: ${inputPath}`);

    const fileContent = readFileSync(inputPath);
    const albumInfo = JSON.parse(fileContent.toString());

    const images = albumInfo.data?.images ?? [];
    console.log(`📦 Found ${images.length} images to process.`);

    const parseTagnumber = (desc: string): number | null => {
      const match = desc.match(/#(\d+)/);
      return match ? parseInt(match[1], 10) : null;
    };

    const isMystery = (desc: string) => /tag/.test(desc) && !/(proof|proof found at|found at)/i.test(desc);
    const isFound = (desc: string) => /(proof|proof found at|found at)/i.test(desc);

    const tagBuckets = new Map<number, { mysteries: any[]; founds: any[] }>();
    const extraImages: any[] = [];

    let duplicateMysteryCount = 0;
    let duplicateFoundCount = 0;
    let noPairCount = 0;

    images.forEach(img => {
      const desc = img.description ?? "";
      const tagnumber = parseTagnumber(desc);
      if (tagnumber === null) {
        extraImages.push(img);
        return;
      }

      if (!tagBuckets.has(tagnumber)) {
        tagBuckets.set(tagnumber, { mysteries: [], founds: [] });
      }

      const bucket = tagBuckets.get(tagnumber)!;
      if (isMystery(desc)) {
        bucket.mysteries.push(img);
      } else if (isFound(desc)) {
        bucket.founds.push(img);
      } else {
        extraImages.push(img);
      }
    });

    console.log(`🔹 Total mysteries identified: ${Array.from(tagBuckets.values()).reduce((sum, b) => sum + b.mysteries.length, 0)}`);
    console.log(`🔹 Total founds identified: ${Array.from(tagBuckets.values()).reduce((sum, b) => sum + b.founds.length, 0)}`);

    const sortedPairs: any[] = [];
    const sortedTagNumbers = Array.from(tagBuckets.keys()).sort((a, b) => a - b);

    sortedTagNumbers.forEach(tn => {
      const bucket = tagBuckets.get(tn)!;
      const hasMystery = bucket.mysteries.length > 0;
      const hasFound = bucket.founds.length > 0;

      if (hasMystery) {
        sortedPairs.push(bucket.mysteries[0]);
        if (bucket.mysteries.length > 1) {
          console.warn(`⚠ Duplicate mysteries for tag #${tn}, moving ${bucket.mysteries.length - 1} to extras.`);
          extraImages.push(...bucket.mysteries.slice(1));
          duplicateMysteryCount++;
        }
      }

      if (hasFound) {
        sortedPairs.push(bucket.founds[0]);
        if (bucket.founds.length > 1) {
          console.warn(`⚠ Duplicate founds for tag #${tn}, moving ${bucket.founds.length - 1} to extras.`);
          extraImages.push(...bucket.founds.slice(1));
          duplicateFoundCount++;
        }
      }

      if (hasMystery && !hasFound) {
        console.log(`ℹ No found image for tag #${tn} (likely expected for last tag).`);
        noPairCount++;
      }
    });

    const remaining = images.filter(img => !sortedPairs.includes(img) && !extraImages.includes(img));
    if (remaining.length > 0) {
      console.warn(`⚠ ${remaining.length} remaining unclassified images appended at end:`);
      remaining.forEach(img => {
        console.warn(`  ➤ Remaining image id=${img.id} description="${img.description}"`);
      });
      extraImages.push(...remaining);
    }

    const sortedImages = [...sortedPairs, ...extraImages];
    const sortedAlbumInfo = { ...albumInfo, data: { ...albumInfo.data, images: sortedImages } };

    writeFileSync(outputPath, JSON.stringify(sortedAlbumInfo, null, 2));
    console.log(`✅ Sorted and saved to ${outputPath}`);

    console.log(`📊 Summary:`);
    console.log(`  - Unique tag numbers processed: ${sortedTagNumbers.length}`);
    console.log(`  - Duplicate mysteries detected: ${duplicateMysteryCount}`);
    console.log(`  - Duplicate founds detected: ${duplicateFoundCount}`);
    console.log(`  - Tags missing found image: ${noPairCount}`);
    console.log(`  - Extra images appended: ${extraImages.length}`);

  } catch (err) {
    console.error(`💥 Error while sorting JSON:`, err);
  }
};

if (process.env.MIGRATE_INPUT_FILE) {
  console.log(`🚀 Running sortTagsJson for MIGRATE_INPUT_FILE=${process.env.MIGRATE_INPUT_FILE}`);
  sortTagsJson(process.env.MIGRATE_INPUT_FILE);
} else {
  console.log('no file to sort', process.env.MIGRATE_INPUT_FILE)
}
