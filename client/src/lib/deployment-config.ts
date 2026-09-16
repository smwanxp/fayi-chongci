/**
 * 这里仅保存非敏感的部署标识。请为自己的飞书应用填写独立存储桶。
 * 密码、令牌和应用密钥不得写入此文件。
 */
export const DEPLOYMENT_CONFIG = {
  contentBucketId: '',
  contentFilePath: 'base-content.json',
  contentBaseVersion: 1,
} as const;
