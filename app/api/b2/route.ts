import { NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  endpoint: process.env.B2_IMAGE_ENDPOINT, // Master endpoint
  region: process.env.B2_REGION || "us-west-004",
  credentials: {
    accessKeyId: process.env.B2_IMAGE_KEY_ID!,
    secretAccessKey: process.env.B2_IMAGE_APP_KEY!,
  },
  forcePathStyle: true,
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const folder = searchParams.get('folder');
  const file = searchParams.get('file');
  const targetBucket = searchParams.get('bucket'); // 🚀 NEW: Accept explicit bucket

  if (!folder || !file) {
    return new NextResponse("Missing folder or file", { status: 400 });
  }

  // Use the explicit bucket if provided, otherwise default to the data bucket for CSVs
  const bucketName = targetBucket || process.env.B2_DATA_BUCKET || 'rapid-revver';

  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: `${folder}${file}`,
    });

    const response = await s3.send(command);
    const stream = response.Body?.transformToWebStream();
    
    return new Response(stream, {
      headers: {
        'Content-Type': response.ContentType || 'application/octet-stream',
      },
    });
  } catch (error) {
    console.error(`API Proxy Error [Bucket: ${bucketName}]:`, error);
    return new NextResponse("Failed to fetch file", { status: 500 });
  }
}