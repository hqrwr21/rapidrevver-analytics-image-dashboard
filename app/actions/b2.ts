"use server";

import { 
  S3Client, ListObjectsV2Command, 
  DeleteObjectCommand, GetObjectCommand, PutObjectCommand,
  PutBucketCorsCommand, CopyObjectCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Connection for CSV Data (rapid-revver)
const s3Data = new S3Client({
  endpoint: process.env.B2_DATA_ENDPOINT,
  region: process.env.B2_REGION || "us-west-004",
  credentials: {
    accessKeyId: process.env.B2_DATA_KEY_ID!,
    secretAccessKey: process.env.B2_DATA_APP_KEY!,
  },
  forcePathStyle: true,
});

// Connection for Images (Master Key to access OX, FR, MUA)
const s3Images = new S3Client({
  endpoint: process.env.B2_IMAGE_ENDPOINT,
  region: process.env.B2_REGION || "us-west-004",
  credentials: {
    accessKeyId: process.env.B2_IMAGE_KEY_ID!,
    secretAccessKey: process.env.B2_IMAGE_APP_KEY!,
  },
  forcePathStyle: true,
});

// 🚀 SMART ROUTER: Detects exact bucket based on Album name
function getBucketForAlbum(album: string) {
  if (album.includes('[FR]')) return 'fuelrider-media';
  if (album.includes('[MUA]')) return 'motorup-media';
  return 'oxgord-media'; // Default for OX or Uncategorized
}

function getS3Target(folder: string, explicitBucket?: string) {
  if (folder.startsWith("images/")) {
    const albumName = folder.replace('images/', '').replace('/', '');
    const bucket = explicitBucket || getBucketForAlbum(albumName);
    return { client: s3Images, bucket };
  }
  return { client: s3Data, bucket: process.env.B2_DATA_BUCKET || 'rapid-revver' };
}

export async function unlockBackblazeCors() {
  const corsConfig = { CORSConfiguration: { CORSRules: [{ AllowedOrigins: ["*"], AllowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"], AllowedHeaders: ["*"], ExposeHeaders: ["ETag"], MaxAgeSeconds: 3000 }] } };
  try {
    await s3Data.send(new PutBucketCorsCommand({ Bucket: process.env.B2_DATA_BUCKET || 'rapid-revver', ...corsConfig }));
    await s3Images.send(new PutBucketCorsCommand({ Bucket: 'oxgord-media', ...corsConfig }));
    await s3Images.send(new PutBucketCorsCommand({ Bucket: 'fuelrider-media', ...corsConfig }));
    await s3Images.send(new PutBucketCorsCommand({ Bucket: 'motorup-media', ...corsConfig }));
    return { success: true };
  } catch (error: any) { return { success: false, error: error.message }; }
}

export async function renameImageInB2(oldName: string, newName: string, folder: string) {
  const { client, bucket } = getS3Target(folder);
  try {
    await client.send(new CopyObjectCommand({ Bucket: bucket, CopySource: encodeURI(`${bucket}/${folder}${oldName}`), Key: `${folder}${newName}` }));
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: `${folder}${oldName}` }));
    return { success: true };
  } catch (error: any) { return { success: false, error: error.message }; }
}

export async function renameAlbumInB2(oldAlbum: string, newAlbum: string) {
  const oldBucket = getBucketForAlbum(oldAlbum);
  const newBucket = getBucketForAlbum(newAlbum);
  const oldPrefix = `images/${oldAlbum}/`;
  const newPrefix = `images/${newAlbum}/`;

  try {
    const command = new ListObjectsV2Command({ Bucket: oldBucket, Prefix: oldPrefix });
    const response: any = await s3Images.send(command);
    const files = response.Contents || [];

    for (const file of files) {
      if (!file.Key) continue;
      const fileName = file.Key.replace(oldPrefix, "");
      await s3Images.send(new CopyObjectCommand({ Bucket: newBucket, CopySource: encodeURI(`${oldBucket}/${file.Key}`), Key: `${newPrefix}${fileName}` }));
      await s3Images.send(new DeleteObjectCommand({ Bucket: oldBucket, Key: file.Key }));
    }
    return { success: true };
  } catch (error: any) { return { success: false, error: error.message }; }
}

export async function listFiles(folder: string): Promise<string[]> {
  try {
    const { client, bucket } = getS3Target(folder);
    let isTruncated = true, continuationToken: string | undefined = undefined;
    const allFiles: string[] = [];
    while (isTruncated) {
      const response: any = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: folder, ContinuationToken: continuationToken }));
      if (response.Contents) allFiles.push(...response.Contents.map((obj: any) => obj.Key?.replace(folder, "")).filter(Boolean) as string[]);
      isTruncated = response.IsTruncated ?? false; continuationToken = response.NextContinuationToken;
    }
    return allFiles;
  } catch (error) { return []; }
}

export async function listFilesWithDetails(folder: string): Promise<{name: string, date: number, bucket?: string}[]> {
  if (folder === 'images/') {
    // 🚀 NEW: Search ALL image buckets simultaneously so the dashboard shows everything
    const buckets = ['oxgord-media', 'fuelrider-media', 'motorup-media'];
    const allFiles: {name: string, date: number, bucket: string}[] = [];

    for (const b of buckets) {
      try {
        let isTruncated = true, continuationToken: string | undefined = undefined;
        while (isTruncated) {
          const response: any = await s3Images.send(new ListObjectsV2Command({ Bucket: b, Prefix: 'images/', ContinuationToken: continuationToken }));
          if (response.Contents) {
            allFiles.push(...response.Contents.map((obj: any) => ({ name: obj.Key?.replace('images/', ''), date: obj.LastModified ? new Date(obj.LastModified).getTime() : 0, bucket: b })).filter((obj: any) => Boolean(obj.name)));
          }
          isTruncated = response.IsTruncated ?? false; continuationToken = response.NextContinuationToken;
        }
      } catch (e) { console.error("Error listing", b); }
    }
    return allFiles;
  }

  // Standard CSV data lookup
  try {
    const { client, bucket } = getS3Target(folder);
    let isTruncated = true, continuationToken: string | undefined = undefined;
    const allFiles: {name: string, date: number}[] = [];
    while (isTruncated) {
      const response: any = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: folder, ContinuationToken: continuationToken }));
      if (response.Contents) allFiles.push(...response.Contents.map((obj: any) => ({ name: obj.Key?.replace(folder, ""), date: obj.LastModified ? new Date(obj.LastModified).getTime() : 0 })).filter((obj: any) => Boolean(obj.name)));
      isTruncated = response.IsTruncated ?? false; continuationToken = response.NextContinuationToken;
    }
    return allFiles;
  } catch (error) { return []; }
}

export async function deleteFileFromB2(fileName: string, folder: string) {
  const { client, bucket } = getS3Target(folder);
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: `${folder}${fileName}` }));
  return true;
}

export async function getPresignedUploadUrl(fileName: string, folderPrefix: string, contentType: string) {
  let bucketName = process.env.B2_DATA_BUCKET || 'rapid-revver';
  let targetClient = s3Data;

  // Route directly to the appropriate brand bucket based on the folder string
  if (folderPrefix.startsWith('images/')) {
    const albumName = folderPrefix.replace('images/', '').replace('/', '');
    bucketName = getBucketForAlbum(albumName);
    targetClient = s3Images;
  }

  const command = new PutObjectCommand({ Bucket: bucketName, Key: `${folderPrefix}${fileName}`, ContentType: contentType });
  return getSignedUrl(targetClient, command, { expiresIn: 3600 });
}

export async function getPresignedDownloadUrl(fileName: string, folder: string) {
  const { client, bucket } = getS3Target(folder);
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: `${folder}${fileName}` }), { expiresIn: 3600 });
}