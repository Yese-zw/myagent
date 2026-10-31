import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import ForceUpdateDialog from './ForceUpdateDialog';

beforeEach(async () => {
    await i18n.changeLanguage('zh-CN');
});

it('shows the release notes and cannot be dismissed', () => {
    const onUpdate = vi.fn();
    render(
        <ForceUpdateDialog
            version="1.2.0"
            notes={'修复登录失败\n补上更新说明'}
            phase="ready"
            onUpdate={onUpdate}
        />,
    );

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('需要更新后才能继续使用')).toBeInTheDocument();
    expect(screen.getByText('更新说明')).toBeInTheDocument();
    expect(screen.getByText(/修复登录失败/)).toBeInTheDocument();
    expect(screen.getByText(/补上更新说明/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '稍后' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement?.parentElement ?? document.body);
    expect(onUpdate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '立即更新' }));
    expect(onUpdate).toHaveBeenCalledOnce();
});

it('keeps the only action disabled while the package is still downloading', () => {
    render(
        <ForceUpdateDialog
            version="1.2.0"
            notes=""
            phase="downloading"
            onUpdate={vi.fn()}
        />,
    );

    expect(screen.getByText('请安装最新版本后继续使用。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '正在下载更新…' })).toBeDisabled();
});
