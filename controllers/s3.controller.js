const AWS = require('aws-sdk');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { File } = require('../models/file.model');

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY,
  secretAccessKey: process.env.AWS_SECRET_KEY,
  region: process.env.AWS_REGION,
});

// Upload a file to S3
const uploadFile = async (fileContent, subFolderName, fileName) => {
  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: `${subFolderName}/${fileName}`,
    Body: fileContent,
  };

  return s3.upload(params).promise();
};

// Process and upload files from a local folder
const uploadLocalFolder = async (folderPath) => {
  const subFolderName = path.basename(folderPath);
  const files = await fs.readdir(folderPath);
  const fileRecords = [];

  for (const fileName of files) {
    const filePath = path.join(folderPath, fileName);
    const fileContent = await fs.readFile(filePath);
    const fileUuid = uuidv4();

    try {
      const uploadResult = await uploadFile(fileContent, subFolderName, fileName);
      fileRecords.push({
        uuid: fileUuid,
        subFolderName,
        fileName,
        s3Url: uploadResult.Location,
      });
      console.log(`Uploaded ${fileName} to ${uploadResult.Location}`);
    } catch (error) {
      console.error(`Error uploading ${fileName}:`, error);
    }
  }

  return fileRecords;
};

// Download file from URL and upload to S3
const uploadFileFromUrl = async (fileUrl, subFolderName, fileName) => {
  try {
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    const fileContent = response.data;
    return uploadFile(fileContent, subFolderName, fileName);
  } catch (error) {
    console.error(`Error downloading from ${fileUrl}:`, error);
    throw error;
  }
};

// Process and upload files from a list of URLs
const uploadUrls = async (urls, subFolderName) => {
  const fileRecords = [];

  for (const url of urls) {
    const fileName = path.basename(url);
    const fileUuid = uuidv4();

    try {
      const uploadResult = await uploadFileFromUrl(url, subFolderName, fileName);
      fileRecords.push({
        uuid: fileUuid,
        subFolderName,
        fileName,
        s3Url: uploadResult.Location,
      });
      console.log(`Uploaded ${fileName} from URL to ${uploadResult.Location}`);
    } catch (error) {
      console.error(`Error uploading ${fileName} from URL:`, error);
    }
  }

  return fileRecords;
};

// Main function to handle uploads from both local folders and URLs
const uploadFoldersAndUrls = async (rootFolder, urlList) => {
  let allFileRecords = [];

  // Handle local folder uploads
  const subFolders = await fs.readdir(rootFolder);
  const directories = await Promise.all(
    subFolders.map(async (file) => {
      const filePath = path.join(rootFolder, file);
      const stats = await fs.lstat(filePath);
      return stats.isDirectory() ? file : null;
    })
  );

  for (const subFolder of directories.filter(Boolean)) {
    const folderPath = path.join(rootFolder, subFolder);
    const fileRecords = await uploadLocalFolder(folderPath);
    allFileRecords = allFileRecords.concat(fileRecords);
  }

  // Handle URL uploads
  if (urlList && urlList.length > 0) {
    const urlRecords = await uploadUrls(urlList, 'urls');
    allFileRecords = allFileRecords.concat(urlRecords);
  }

  // Save all records to the database
  try {
    if (allFileRecords.length > 0) {
      await File.bulkCreate(allFileRecords);
      console.log('Successfully inserted records into the database.');
    }
  } catch (error) {
    console.error('Error inserting records into the database:', error);
  }
};

module.exports = {
  uploadLocalFolder,
  uploadUrls,
  uploadFoldersAndUrls,
};
