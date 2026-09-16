import { ForbiddenException } from '@nestjs/common';
import type { AuthorizationSDK } from '@lark-apaas/fullstack-nestjs-core';

import { PlatformRoleService } from '../../server/common/services/platform-role.service';

describe('PlatformRoleService', () => {
  function setup(pages: Array<{ users: Array<{ userID?: string; miaodaUserID?: string }>; hasMore?: boolean }>) {
    const list = jest.fn();
    for (const page of pages) {
      list.mockResolvedValueOnce({
        members: { userList: page.users },
        total: page.users.length,
        hasMore: Boolean(page.hasMore),
      });
    }
    const sdk = { members: { list } } as unknown as AuthorizationSDK;
    return { service: new PlatformRoleService(sdk), list };
  }

  it('allows a direct Miaoda user member', async () => {
    const { service } = setup([{ users: [{ userID: 'user-1' }] }]);
    await expect(service.requireAny('user-1', ['fayi_admin'])).resolves.toBeUndefined();
  });

  it('checks later roles when the first role does not match', async () => {
    const { service, list } = setup([
      { users: [] },
      { users: [{ miaodaUserID: 'user-2' }] },
    ]);
    await expect(service.requireAny('user-2', ['fayi_admin', 'fayi_student'])).resolves.toBeUndefined();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('rejects users missing every required platform role', async () => {
    const { service } = setup([{ users: [] }, { users: [] }]);
    await expect(service.requireAny('user-3', ['fayi_admin', 'fayi_student'])).rejects.toBeInstanceOf(ForbiddenException);
  });
});
