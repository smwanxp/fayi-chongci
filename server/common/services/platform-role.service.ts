import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuthorizationSDK } from '@lark-apaas/fullstack-nestjs-core';

@Injectable()
export class PlatformRoleService {
  private readonly membershipCache = new Map<string, { allowed: boolean; expiresAt: number }>();

  constructor(private readonly authorizationSDK: AuthorizationSDK) {}

  async requireAny(userId: string, roleIds: string[]): Promise<void> {
    for (const roleId of roleIds) {
      if (await this.isDirectMember(userId, roleId)) return;
    }

    throw new ForbiddenException('当前飞书账号没有访问此功能的角色');
  }

  private async isDirectMember(userId: string, roleId: string): Promise<boolean> {
    const cacheKey = `${roleId}:${userId}`;
    const cached = this.membershipCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.allowed;

    let page = 1;
    do {
      const response = await this.authorizationSDK.members.list(roleId, {
        type: 'User',
        page,
        pageSize: 100,
      });
      const matched = (response.members.userList ?? []).some(member =>
        member.userID === userId || member.miaodaUserID === userId,
      );
      if (matched) {
        this.membershipCache.set(cacheKey, { allowed: true, expiresAt: Date.now() + 30_000 });
        return true;
      }
      if (!response.hasMore) {
        this.membershipCache.set(cacheKey, { allowed: false, expiresAt: Date.now() + 5_000 });
        return false;
      }
      page += 1;
    } while (page <= 100);

    this.membershipCache.set(cacheKey, { allowed: false, expiresAt: Date.now() + 5_000 });
    return false;
  }
}
