import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type { AxiosRequestConfig } from 'axios';
import type {
  AddAdminStudentsRequest,
  AdminContentSyncRequest,
  AdminContentSyncResponse,
  GetStudyDataResponse,
  ListAdminStudentsResponse,
  RemoveAdminStudentsRequest,
  SaveStudyDataRequest,
  SaveStudyDataResponse,
  UpdateAdminStudentRemarkRequest,
} from '@shared/api.interface';
import { prepareStudyPayloadForCloud } from '@/lib/cloud-payload';
import type { BackupPayload } from '@/lib/types';

type BackendErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: string;
  };
};

function responseData<T>(response: { status?: number; data: T | BackendErrorBody }): T {
  const errorBody = response.data as BackendErrorBody;
  if ((response.status ?? 200) >= 400 || errorBody?.error) {
    const denied = response.status === 403 || errorBody.error?.code === 'FORBIDDEN';
    throw new Error(denied
      ? '当前飞书账号没有访问此功能的权限'
      : errorBody.error?.message ?? '服务器暂时无法处理请求');
  }
  return response.data as T;
}

function normalizeRejectedError(error: unknown): Error {
  const candidate = error as {
    message?: string;
    response?: { status?: number; data?: BackendErrorBody };
  };
  const status = candidate.response?.status;
  const body = candidate.response?.data;
  if (status === 403 || body?.error?.code === 'FORBIDDEN') {
    const normalized = new Error('当前飞书账号没有访问此功能的权限') as Error & { cause?: unknown };
    normalized.cause = error;
    return normalized;
  }
  if (error instanceof Error) return error;
  const normalized = new Error(body?.error?.message ?? candidate.message ?? '服务器暂时无法处理请求') as Error & { cause?: unknown };
  normalized.cause = error;
  return normalized;
}

async function backendRequest<T>(config: AxiosRequestConfig): Promise<T> {
  try {
    const response = await axiosForBackend.request(config);
    return responseData<T>(response);
  } catch (error) {
    throw normalizeRejectedError(error);
  }
}

export async function getStudyData(): Promise<GetStudyDataResponse> {
  try {
    return await backendRequest<GetStudyDataResponse>({ url: '/api/data', method: 'GET' });
  } catch (error) {
    logger.error('读取学习数据失败', error);
    throw error;
  }
}

export async function saveStudyData(body: SaveStudyDataRequest): Promise<SaveStudyDataResponse> {
  try {
    const uploadId = crypto.randomUUID();
    const compactPayload = await prepareStudyPayloadForCloud(
      body.payload as unknown as BackupPayload,
    );
    const bytes = new TextEncoder().encode(JSON.stringify(compactPayload));
    const chunkSize = 48 * 1024;
    const totalChunks = Math.ceil(bytes.length / chunkSize);
    for (let index = 0; index < totalChunks; index += 1) {
      const chunk = bytes.slice(index * chunkSize, (index + 1) * chunkSize);
      let binary = '';
      for (let offset = 0; offset < chunk.length; offset += 8192) {
        binary += String.fromCharCode(...chunk.subarray(offset, offset + 8192));
      }
      await backendRequest<unknown>({
        url: `/api/data/upload/${uploadId}/${index}`,
        method: 'PUT',
        data: { data: btoa(binary) },
      });
    }
    return await backendRequest<SaveStudyDataResponse>({
      url: `/api/data/upload/${uploadId}/commit`,
      method: 'POST',
      data: { totalChunks },
    });
  } catch (error) {
    logger.error('保存学习数据失败', error);
    throw error;
  }
}

export async function getAdminStudents(): Promise<ListAdminStudentsResponse> {
  try {
    return await backendRequest<ListAdminStudentsResponse>({ url: '/api/admin/students', method: 'GET' });
  } catch (error) {
    logger.error('读取学习用户失败', error);
    throw error;
  }
}

export async function addAdminStudents(body: AddAdminStudentsRequest) {
  try {
    return await backendRequest<{ added: number; initialized: number }>({ url: '/api/admin/students', method: 'POST', data: body });
  } catch (error) {
    logger.error('添加学习用户失败', error);
    throw error;
  }
}

export async function removeAdminStudents(body: RemoveAdminStudentsRequest) {
  try {
    return await backendRequest<{ removed: number; deleted: number }>({ url: '/api/admin/students/remove', method: 'POST', data: body });
  } catch (error) {
    logger.error('移除学习用户失败', error);
    throw error;
  }
}

export async function updateAdminStudentRemark(body: UpdateAdminStudentRemarkRequest) {
  try {
    return await backendRequest<{ userId: string; remark: string }>({ url: '/api/admin/students/remark', method: 'PUT', data: body });
  } catch (error) {
    logger.error('保存用户备注失败', error);
    throw error;
  }
}

export async function syncAdminContent(body: AdminContentSyncRequest): Promise<AdminContentSyncResponse> {
  try {
    return await backendRequest<AdminContentSyncResponse>({ url: '/api/admin/content-sync', method: 'POST', data: body });
  } catch (error) {
    logger.error('同步学习内容失败', error);
    throw error;
  }
}
