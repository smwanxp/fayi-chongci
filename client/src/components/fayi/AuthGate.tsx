import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ROLE_SUBJECT, useAuth as usePlatformAuth } from '@lark-apaas/client-toolkit/auth';
import { useCurrentUserProfile } from '@lark-apaas/client-toolkit/hooks/useCurrentUserProfile';

import { getStudyData, saveStudyData } from '@/api';
import {
  configureStudyFileStorage,
  hydrateStudyPayload,
  isCompactStudyPayload,
} from '@/lib/cloud-payload';
import { repository } from '@/lib/repository';
import type { BackupPayload } from '@/lib/types';

export interface AppUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'student';
}

interface AuthContextValue {
  user: AppUser;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthGate is missing');
  return value;
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const userInfo = useCurrentUserProfile();
  const { ability, isLoading: permissionsLoading } = usePlatformAuth();
  const isAdmin = ability.can('fayi_admin', ROLE_SUBJECT);
  const isStudent = ability.can('fayi_student', ROLE_SUBJECT);
  const authorized = isAdmin || isStudent;
  const [phase, setPhase] = useState<'waiting' | 'syncing' | 'ready' | 'error'>('waiting');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userInfo?.user_id || permissionsLoading || !authorized) return;
    let active = true;
    void (async () => {
      try {
        setPhase('syncing');
        setError('');
        repository.disableRemoteSync();
        const cloud = await getStudyData();
        if (!active) return;
        configureStudyFileStorage(cloud.payload);
        if (cloud.payload) {
          const needsStorageMigration = !isCompactStudyPayload(cloud.payload);
          const hydratedPayload = await hydrateStudyPayload(cloud.payload);
          await repository.restoreBackup(hydratedPayload);
          await repository.initialize(true);
          if (needsStorageMigration) {
            await saveStudyData({ payload: await repository.exportBackup() });
          }
        } else {
          await repository.initialize(true);
          const payload = await repository.exportBackup();
          await saveStudyData({ payload });
        }
        repository.enableRemoteSync();
        if (active) setPhase('ready');
      } catch (caught) {
        repository.disableRemoteSync();
        if (!active) return;
        setError(caught instanceof Error ? caught.message : '无法载入学习数据');
        setPhase('error');
      }
    })();
    return () => { active = false; };
  }, [attempt, authorized, permissionsLoading, userInfo?.user_id]);

  if (!userInfo?.user_id || permissionsLoading || phase === 'syncing') {
    return <AuthLoading waiting={!userInfo?.user_id} />;
  }
  if (!authorized) {
    return <main className="auth-screen"><section className="auth-card login-card"><div className="auth-mark">法</div><p className="section-kicker">法忆冲刺 · 邀请制</p><h1>当前飞书账号尚未获授权</h1><p>请联系管理员将你加入“法忆学习用户”角色。应用不会自动注册或创建题库。</p></section></main>;
  }
  if (phase === 'waiting') return <AuthLoading waiting={false} />;
  if (phase === 'error') {
    return <main className="auth-screen"><section className="auth-card login-card"><div className="auth-mark">法</div><p className="section-kicker">飞书云端同步</p><h1>学习数据暂时未能载入</h1><p className="auth-error">{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>重新连接</button></section></main>;
  }

  const user: AppUser = {
    id: userInfo.user_id,
    username: userInfo.name || userInfo.user_id,
    displayName: userInfo.name || '飞书用户',
    role: isAdmin ? 'admin' : 'student',
  };
  return <AuthContext.Provider value={{ user, logout: async () => repository.flushRemoteSync() }}>{children}</AuthContext.Provider>;
}

function AuthLoading({ waiting }: { waiting: boolean }) {
  return <main className="auth-screen"><section className="auth-card auth-loading"><div className="auth-mark">法</div><p className="section-kicker">法忆冲刺 · 飞书版</p><h1>{waiting ? '正在确认飞书身份' : '正在载入你的独立题库'}</h1><span className="auth-loading-line"><i /></span><small>口诀、进度与笔记均按当前飞书账号隔离</small></section></main>;
}
