import { render, screen } from '@testing-library/react';
import { createRef, type ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FeedbackPopover from './FeedbackPopover';

const mocks = vi.hoisted(() => ({
  popoverProps: null as ComponentProps<typeof import('@/components/ui/Popover').Popover> | null,
  communityGroupImage: '',
}));

vi.mock('@/components/ui/Popover', () => ({
  Popover: (props: ComponentProps<typeof import('@/components/ui/Popover').Popover>) => {
    mocks.popoverProps = props;
    return <div data-testid="feedback-popover">{props.children}</div>;
  },
}));

vi.mock('@/features/account/useCommunityGroupImage', () => ({
  useCommunityGroupImage: () => mocks.communityGroupImage,
}));

describe('FeedbackPopover', () => {
  beforeEach(() => {
    mocks.popoverProps = null;
    mocks.communityGroupImage = '';
  });

  it('opens beside the sidebar edge with the shared App Shell surface', () => {
    const triggerRef = createRef<HTMLDivElement>();

    render(
      <FeedbackPopover
        open
        onClose={vi.fn()}
        onOpenBugReport={vi.fn()}
        triggerRef={triggerRef}
      />,
    );

    expect(screen.getByTestId('feedback-popover')).toBeInTheDocument();
    expect(mocks.popoverProps).toMatchObject({
      placement: 'right-end',
      offset: 8,
      unstyled: true,
    });
    expect(mocks.popoverProps?.className).toContain('bg-[var(--paper-elevated)]');
    expect(mocks.popoverProps?.className).toContain('shadow-xl');
    expect(mocks.popoverProps?.className).toContain('rounded-xl');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows the community group image from gateway settings', () => {
    mocks.communityGroupImage = 'data:image/png;base64,abc';
    render(
      <FeedbackPopover
        open
        onClose={vi.fn()}
        onOpenBugReport={vi.fn()}
        triggerRef={createRef<HTMLDivElement>()}
      />,
    );
    expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/png;base64,abc');
  });
});
