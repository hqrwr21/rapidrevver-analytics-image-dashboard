// app/actions/b2.ts
"use server";

import { 
  S3Client, ListObjectsV2Command, 
  DeleteObjectCommand, GetObjectCommand, PutObjectCommand,
  PutBucketCorsCommand, CopyObjectCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3Data = new S3Client({
  endpoint: process.env.B2_DATA_ENDPOINT,
  region: process.env.B2_REGION || "us-west-004",
  credentials: {
    accessKeyId: process.env.B2_DATA_KEY_ID!,
    secretAccessKey: process.env.B2_DATA_APP_KEY!,
  },
  forcePathStyle: true,
});

const s3Images = new S3Client({
  endpoint: process.env.B2_IMAGE_ENDPOINT,
  region: process.env.B2_REGION || "us-west-004",
  credentials: {
    accessKeyId: process.env.B2_IMAGE_KEY_ID!,
    secretAccessKey: process.env.B2_IMAGE_APP_KEY!,
  },
  forcePathStyle: true,
});

function getS3Target(folder: string) {
  if (folder.startsWith("images/")) {
    return { client: s3Images, bucket: process.env.B2_IMAGE_BUCKET! };
  }
  return { client: s3Data, bucket: process.env.B2_DATA_BUCKET! };
}

// ==========================================
// 🚀 UNLOCK CORS PERMANENTLY
// ==========================================
export async function unlockBackblazeCors() {
  const corsConfig = {
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: ["*"], 
          AllowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"], 
          AllowedHeaders: ["*"],
          ExposeHeaders: ["ETag"],
          MaxAgeSeconds: 3000,
        },
      ],
    },
  };

  try {
    await s3Data.send(new PutBucketCorsCommand({ Bucket: process.env.B2_DATA_BUCKET!, ...corsConfig }));
    if (process.env.B2_DATA_BUCKET !== process.env.B2_IMAGE_BUCKET) {
      await s3Images.send(new PutBucketCorsCommand({ Bucket: process.env.B2_IMAGE_BUCKET!, ...corsConfig }));
    }
    return { success: true };
  } catch (error: any) {
    console.error("CORS Unlock Error:", error);
    return { success: false, error: error.message };
  }
}

// ==========================================
// ✏️ RENAME LOGIC
// ==========================================
export async function renameImageInB2(oldName: string, newName: string, folder: string) {
  const { client, bucket } = getS3Target(folder);
  try {
    await client.send(new CopyObjectCommand({
      Bucket: bucket,
      CopySource: encodeURI(`${bucket}/${folder}${oldName}`),
      Key: `${folder}${newName}`,
    }));
    await client.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: `${folder}${oldName}`
    }));
    return { success: true };
  } catch (error: any) {
    console.error("Rename Image Error:", error);
    return { success: false, error: error.message };
  }
}

export async function renameAlbumInB2(oldAlbum: string, newAlbum: string) {
  const { client, bucket } = getS3Target("images/");
  const oldPrefix = `images/${oldAlbum}/`;
  const newPrefix = `images/${newAlbum}/`;

  try {
    const command = new ListObjectsV2Command({ Bucket: bucket, Prefix: oldPrefix });
    const response: any = await client.send(command);
    const files = response.Contents || [];

    for (const file of files) {
      if (!file.Key) continue;
      const fileName = file.Key.replace(oldPrefix, "");
      
      await client.send(new CopyObjectCommand({
        Bucket: bucket,
        CopySource: encodeURI(`${bucket}/${file.Key}`),
        Key: `${newPrefix}${fileName}`,
      }));

      await client.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: file.Key
      }));
    }
    return { success: true };
  } catch (error: any) {
    console.error("Rename Album Error:", error);
    return { success: false, error: error.message };
  }
}

// ==========================================
// STANDARD B2 FUNCTIONS
// ==========================================

export async function listFiles(folder: string): Promise<string[]> {
  try {
    const { client, bucket } = getS3Target(folder);
    let isTruncated = true;
    let continuationToken: string | undefined = undefined;
    const allFiles: string[] = [];

    while (isTruncated) {
      const command = new ListObjectsV2Command({ 
        Bucket: bucket, 
        Prefix: folder,
        ContinuationToken: continuationToken
      });
      const response: any = await client.send(command);
      
      if (response.Contents) {
        const keys = response.Contents.map((obj: any) => obj.Key?.replace(folder, "")).filter(Boolean) as string[];
        allFiles.push(...keys);
      }
      
      isTruncated = response.IsTruncated ?? false;
      continuationToken = response.NextContinuationToken;
    }
    return allFiles;
  } catch (error) {
    return [];
  }
}

export async function deleteFileFromB2(fileName: string, folder: string) {
  const { client, bucket } = getS3Target(folder);
  const command = new DeleteObjectCommand({ Bucket: bucket, Key: `${folder}${fileName}` });
  await client.send(command);
  return true;
}

export async function getPresignedDownloadUrl(fileName: string, folder: string) {
  const { client, bucket } = getS3Target(folder);
  const command = new GetObjectCommand({ Bucket: bucket, Key: `${folder}${fileName}` });
  return getSignedUrl(client, command, { expiresIn: 3600 });
}

export async function getPublicB2Url(fileName: string, folder: string) {
  const { bucket } = getS3Target(folder);
  const endpoint = folder.startsWith("images/") ? process.env.B2_IMAGE_ENDPOINT : process.env.B2_DATA_ENDPOINT;
  const fullPath = `${folder}${fileName}`;
  const safePath = fullPath.split('/').map(segment => encodeURIComponent(segment)).join('/');
  return `${endpoint}/${bucket}/${safePath}`;
}

// ==========================================
// 🛍️ NEW: MARKETPLACE MULTI-LINK GENERATOR
// ==========================================
export async function getMarketplaceImageUrls(fileName: string, folder: string) {
  const rawUrl = await getPublicB2Url(fileName, folder);

  // Checks for optional custom domain environment variables; falls back to raw query params
  const frBase = process.env.FR_IMAGE_BASE_URL;
  const oxBase = process.env.OX_IMAGE_BASE_URL;
  const sotBase = process.env.SOT_IMAGE_BASE_URL;

  const fullPath = `${folder}${fileName}`;
  const safePath = fullPath.split('/').map(segment => encodeURIComponent(segment)).join('/');

  return {
    fr: frBase ? `${frBase}/${safePath}` : `${rawUrl}?mp=FR`,
    ox: oxBase ? `${oxBase}/${safePath}` : `${rawUrl}?mp=OX`,
    sot: sotBase ? `${sotBase}/${safePath}` : `${rawUrl}?mp=SOT`,
    raw: rawUrl
  };
}

export async function getPresignedUploadUrl(fileName: string, folder: string, contentType: string) {
  const { client, bucket } = getS3Target(folder);
  const command = new PutObjectCommand({ Bucket: bucket, Key: `${folder}${fileName}`, ContentType: contentType });
  return getSignedUrl(client, command, { expiresIn: 900 });
}

export async function listFilesWithDetails(folder: string): Promise<{name: string, date: number}[]> {
  try {
    const { client, bucket } = getS3Target(folder);
    let isTruncated = true;
    let continuationToken: string | undefined = undefined;
    const allFiles: {name: string, date: number}[] = [];

    while (isTruncated) {
      const command = new ListObjectsV2Command({ 
        Bucket: bucket, 
        Prefix: folder,
        ContinuationToken: continuationToken
      });
      const response: any = await client.send(command);
      
      if (response.Contents) {
        const files = response.Contents.map((obj: any) => ({
          name: obj.Key?.replace(folder, ""),
          date: obj.LastModified ? new Date(obj.LastModified).getTime() : 0
        })).filter((obj: any) => Boolean(obj.name));
        allFiles.push(...files);
      }
      
      isTruncated = response.IsTruncated ?? false;
      continuationToken = response.NextContinuationToken;
    }
    
    return allFiles;
  } catch (error) {
    return [];
  }
}