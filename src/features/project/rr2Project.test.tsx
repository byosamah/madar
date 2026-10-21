import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OfficeRight, RoleSettings, StoredRight } from '../../api/contract/entities';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';
import { without, withExtra } from '../../test/rr2work';

/**
 * Every control of the project page hides when its switch is off (role rights version 2, design section 7). Each case renders the
 * page twice, once with the default Member rights (the control shows) and once with the switch off (the control is gone). The leader of
 * prj_001 is usr_002 (Faisal), a person on its team is usr_005 (Sara), and usr_010 is Management. The Member holds `.lead` and `.team`
 * switches by default, and the leader counts as on the team for a `.team` switch.
 */
const LEADER = 'usr_002';
const TEAM = 'usr_005';
const MANAGEMENT = 'usr_010';

const as = (userId: string, roles?: RoleSettings) => (state: State) => {
  state.session.currentUserId = userId;
  if (roles) state.settings.roles = roles;
};

type Case = {
  name: string;
  user?: string;
  url: string;
  /** A switch of the Member that the second render turns off. */
  off: OfficeRight[];
  /** A signal that the page has loaded, so a missing control is a real absence. */
  ready: () => Promise<unknown>;
  /** The control, or null when it is not there. */
  find: () => HTMLElement | null;
  /** Steps before the finder, such as the opening of a menu. */
  open?: () => Promise<void>;
};

const moreMenu = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
};
const fileMenu = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Actions for Ground floor plan.pdf' }));
};
const addMenu = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Add' }));
};
const item = (name: string) => screen.queryByRole('menuitem', { name });

const CASES: Case[] = [
  { name: 'Post update (header)', user: LEADER, url: '/projects/prj_001', off: ['post.create.team'], ready: () => screen.findByRole('button', { name: 'More actions' }), find: () => screen.queryByRole('button', { name: 'Post update' }) },
  { name: 'Project chat (header)', user: TEAM, url: '/projects/prj_001', off: ['chat.project.team'], ready: () => screen.findByRole('heading', { level: 1, name: 'Corniche Office Tower' }), find: () => screen.queryByRole('link', { name: 'Project chat' }) },
  { name: 'Edit project', user: LEADER, url: '/projects/prj_001', off: ['project.details.lead'], ready: () => screen.findByRole('button', { name: 'More actions' }), open: moreMenu, find: () => item('Edit project') },
  { name: 'Change leader', user: LEADER, url: '/projects/prj_001', off: ['project.leader.lead'], ready: () => screen.findByRole('button', { name: 'More actions' }), open: moreMenu, find: () => item('Change leader') },
  { name: 'Apply a template', user: LEADER, url: '/projects/prj_001', off: ['project.template.lead'], ready: () => screen.findByRole('button', { name: 'More actions' }), open: moreMenu, find: () => item('Apply a template') },
  { name: 'Pause project', user: LEADER, url: '/projects/prj_001', off: ['project.archive.lead'], ready: () => screen.findByRole('button', { name: 'More actions' }), open: moreMenu, find: () => item('Pause project') },
  { name: 'Stage dates', user: LEADER, url: '/projects/prj_001?tab=schedule', off: ['project.stages.lead'], ready: () => screen.findByRole('heading', { name: 'Deadlines' }), find: () => screen.queryAllByLabelText(/^Start of /)[0] ?? null },
  { name: 'Add deadline', user: LEADER, url: '/projects/prj_001?tab=schedule', off: ['project.deadlines.lead'], ready: () => screen.findByRole('heading', { name: 'Deadlines' }), find: () => screen.queryByRole('button', { name: 'Add deadline' }) },
  { name: 'Add member', user: LEADER, url: '/projects/prj_001?tab=team', off: ['project.team.lead'], ready: () => screen.findByRole('region', { name: 'Members' }), find: () => screen.queryByRole('region', { name: 'Add member' }) },
  { name: 'Discipline field', user: LEADER, url: '/projects/prj_001?tab=team', off: ['project.team.lead'], ready: () => screen.findByRole('region', { name: 'Members' }), find: () => screen.queryByLabelText('Discipline of Yousef Saleh') },
  { name: 'Make leader', user: LEADER, url: '/projects/prj_001?tab=team', off: ['project.leader.lead'], ready: () => screen.findByRole('region', { name: 'Members' }), open: async () => { await userEvent.click(await screen.findByRole('button', { name: 'Actions for Sara Al-Qahtani' })); }, find: () => item('Make leader') },
  { name: 'Upload a file (Add menu)', user: TEAM, url: '/projects/prj_001?tab=files', off: ['file.upload.team'], ready: () => screen.findByRole('region', { name: 'Construction Documents' }), open: addMenu, find: () => item('Upload a file') },
  { name: 'Add a link (Add menu)', user: TEAM, url: '/projects/prj_001?tab=files', off: ['project.links.team'], ready: () => screen.findByRole('region', { name: 'Construction Documents' }), open: addMenu, find: () => item('Add a link') },
  { name: 'Received from the client', user: TEAM, url: '/projects/prj_001?tab=files', off: ['file.deliver.team'], ready: () => screen.findByRole('region', { name: 'Construction Documents' }), find: () => screen.queryByLabelText('Received from the client') },
  { name: 'Share in chat', user: TEAM, url: '/projects/prj_001?tab=files', off: ['file.share'], ready: () => screen.findByRole('region', { name: 'Construction Documents' }), open: fileMenu, find: () => item('Share in chat') },
  { name: 'Delete (file menu)', user: LEADER, url: '/projects/prj_001?tab=files', off: ['file.deleteAny.lead', 'file.deleteOwn'], ready: () => screen.findByRole('region', { name: 'Construction Documents' }), open: fileMenu, find: () => item('Delete') },
  { name: 'Mark as delivered to client', user: TEAM, url: '/projects/prj_001?tab=files', off: ['file.deliver.team'], ready: () => screen.findByRole('region', { name: 'Construction Documents' }), open: fileMenu, find: () => item('Mark as delivered to client') },
  { name: 'Post composer', user: TEAM, url: '/projects/prj_001?tab=activity', off: ['post.create.team'], ready: () => screen.findByRole('region', { name: 'Updates' }), find: () => screen.queryByRole('form', { name: 'Post an update' }) },
  { name: 'Tracker quick log', user: TEAM, url: '/projects/prj_001?tab=tracker', off: ['tracker.log.team'], ready: () => screen.findByRole('region', { name: 'History' }), find: () => screen.queryByPlaceholderText(/^Log something/) },
  { name: 'Tracker Export', user: TEAM, url: '/projects/prj_001?tab=tracker', off: ['tracker.export'], ready: () => screen.findByRole('region', { name: 'History' }), find: () => screen.queryByRole('button', { name: 'Export' }) },
  { name: 'Attach in the post box', user: TEAM, url: '/projects/prj_001?tab=activity', off: ['file.upload.team'], ready: () => screen.findByRole('region', { name: 'Updates' }), find: () => screen.queryByText('Attach files') },
  { name: 'Attach in the Tracker log', user: TEAM, url: '/projects/prj_001?tab=tracker', off: ['file.upload.team'], ready: () => screen.findByRole('region', { name: 'History' }), find: () => screen.queryByText('Attach files') },
  { name: 'Quick add of a to-do', user: TEAM, url: '/projects/prj_001?tab=tasks', off: ['task.add.team'], ready: () => screen.findAllByRole('heading', { name: /Construction Documents/ }), find: () => screen.queryAllByRole('textbox', { name: /^Add a to-do in/ })[0] ?? null },
  { name: 'Plan a meeting', user: TEAM, url: '/projects/prj_001', off: ['meeting.plan.team'], ready: () => screen.findByRole('heading', { name: 'About' }), find: () => screen.queryByRole('button', { name: 'Plan a meeting' }) },
];

describe.each(CASES)('$name', (item) => {
  it('shows with the switch on', async () => {
    await renderApp(item.url, as(item.user ?? LEADER));
    await item.ready();
    await item.open?.();
    await waitFor(() => expect(item.find()).not.toBeNull());
  });

  it('is gone with the switch off', async () => {
    await renderApp(item.url, as(item.user ?? LEADER, without(...item.off)));
    await item.ready();
    await item.open?.().catch(() => undefined);
    // The control may be gone with its menu. The page has loaded, so a missing control is a real absence.
    await waitFor(() => expect(item.find()).toBeNull());
  });
});

describe('Ask to reply in the Tracker log (tracker.reply)', () => {
  const askForReply = async () => {
    await screen.findByPlaceholderText(/^Log something/);
    await userEvent.click(document.getElementById('tracker-wait') as HTMLElement);
  };

  it('asks who replies with the switch on', async () => {
    await renderApp('/projects/prj_001?tab=tracker', as(TEAM));
    await askForReply();
    expect(await screen.findByLabelText('Who replies?')).toBeInTheDocument();
  });

  it('keeps the wait switch and asks nobody to reply with tracker.reply off', async () => {
    await renderApp('/projects/prj_001?tab=tracker', as(TEAM, without('tracker.reply')));
    await askForReply();
    expect(document.getElementById('tracker-wait')).toBeChecked();
    expect(screen.queryByLabelText('Who replies?')).toBeNull();
  });

  it('lists only the person as the one who replies with task.assign off', async () => {
    await renderApp('/projects/prj_001?tab=tracker', as(TEAM, without('task.assign')));
    await askForReply();
    const who = await screen.findByLabelText('Who replies?');
    expect(within(who).getAllByRole('option')).toHaveLength(1);
  });

  it('asks nobody to reply without the right to add a to-do here (task.add)', async () => {
    await renderApp('/projects/prj_001?tab=tracker', as(TEAM, without('task.add.team')));
    await askForReply();
    expect(screen.queryByLabelText('Who replies?')).toBeNull();
  });
});

describe('Open loops (tracker.log)', () => {
  /** Two entries of prj_001: one waits for our reply (the Tracker tab), one waits for the client (the Overview lists it too). */
  const withLoops = (roles?: RoleSettings) => (state: State) => {
    as(TEAM, roles)(state);
    const base = { projectId: 'prj_001', type: 'message' as const, note: '', closedAt: null, closedBy: null, fileIds: [], peopleIds: [], auto: null, createdBy: 'usr_002', createdAt: '2026-09-25T10:00:00.000+03:00' };
    state.tracker = {
      ...state.tracker,
      trk_901: { ...base, id: 'trk_901', direction: 'in', title: 'Client asked for the lease plan', date: '2026-09-25', waiting: 'us' },
      trk_902: { ...base, id: 'trk_902', direction: 'out', title: 'We asked for the signed brief', date: '2026-09-27', waiting: 'client' },
    };
  };

  it('shows Received on the Overview and Answered on the Tracker tab with the switch on', async () => {
    await renderApp('/projects/prj_001', withLoops());
    expect((await screen.findAllByRole('button', { name: /^Received/ })).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('tab', { name: 'Tracker' }));
    expect((await screen.findAllByRole('button', { name: /^Answered/ })).length).toBeGreaterThan(0);
  });

  it('shows the loop and no button on the Overview with the switch off', async () => {
    await renderApp('/projects/prj_001', withLoops(without('tracker.log.team')));
    expect(await screen.findByText('We asked for the signed brief')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Received/ })).toBeNull();
  });

  it('shows the loops and no button on the Tracker tab with the switch off', async () => {
    await renderApp('/projects/prj_001?tab=tracker', withLoops(without('tracker.log.team')));
    expect((await screen.findAllByText('Client asked for the lease plan')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^Answered/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Received/ })).toBeNull();
  });
});

describe('Assign a reply on an entry (tracker.reply)', () => {
  const entry = (roles?: RoleSettings) => (state: State) => {
    as(TEAM, roles)(state);
    state.tracker = {
      ...state.tracker,
      trk_901: {
        id: 'trk_901', projectId: 'prj_001', type: 'message', direction: 'in', title: 'Client asked for the lease plan', note: '', date: '2026-09-25', waiting: 'us',
        closedAt: null, closedBy: null, fileIds: [], peopleIds: [], auto: null, createdBy: 'usr_002', createdAt: '2026-09-25T10:00:00.000+03:00',
      },
    };
  };
  const openEntry = async () => {
    await userEvent.click((await screen.findAllByRole('button', { name: 'Open Client asked for the lease plan' }))[0]);
    return screen.findByRole('dialog');
  };

  it('offers Assign a reply with the switch on', async () => {
    await renderApp('/projects/prj_001?tab=tracker', entry());
    const sheet = await openEntry();
    expect(await within(sheet).findByRole('button', { name: 'Assign a reply' })).toBeInTheDocument();
  });

  it('takes Assign a reply away with the switch off and keeps the entry', async () => {
    await renderApp('/projects/prj_001?tab=tracker', entry(without('tracker.reply')));
    const sheet = await openEntry();
    expect(await within(sheet).findByText('Waiting for our reply', { exact: false })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Assign a reply' })).toBeNull();
  });
});

describe('Delete project (project.delete.lead, off by default)', () => {
  it('is not in the menu by default', async () => {
    await renderApp('/projects/prj_001', as(LEADER));
    await moreMenu();
    expect(item('Edit project')).not.toBeNull();
    expect(item('Delete project')).toBeNull();
  });

  it('shows with the switch on', async () => {
    await renderApp('/projects/prj_001', as(LEADER, withExtra('project.delete.lead' as StoredRight)));
    await moreMenu();
    expect(await screen.findByRole('menuitem', { name: 'Delete project' })).toBeInTheDocument();
  });
});

describe('View only tag', () => {
  it('shows no tag for a person who can change the project', async () => {
    await renderApp('/projects/prj_001', as(LEADER));
    await screen.findByRole('button', { name: 'More actions' });
    expect(screen.queryByText('View only')).toBeNull();
  });
});

describe('the comment box of a post (comment.create)', () => {
  it('shows "Add a comment" with the switch on and takes it away with the switch off', async () => {
    await renderApp('/projects/prj_001?tab=activity', as(TEAM));
    const toggles = await screen.findAllByRole('button', { name: /comment/i });
    await userEvent.click(toggles[0]);
    expect(await screen.findByLabelText('Add a comment')).toBeInTheDocument();
  });

  it('shows the quiet line instead of the box with the switch off', async () => {
    await renderApp('/projects/prj_001?tab=activity', as(TEAM, without('comment.create.team')));
    const toggles = await screen.findAllByRole('button', { name: /comment/i });
    await userEvent.click(toggles[0]);
    expect(await screen.findByText('Only the project team can comment here.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Add a comment')).toBeNull();
  });
});

describe('the Payments panel (payment.view, payment.add)', () => {
  const panel = () => screen.findByRole('heading', { name: 'Payments' });

  it('shows the panel and Add payment to Management by default', async () => {
    await renderApp('/projects/prj_001', as(MANAGEMENT));
    await panel();
    expect(screen.getByRole('button', { name: 'Add payment' })).toBeInTheDocument();
  });

  it('keeps the panel and drops Add payment without payment.add', async () => {
    await renderApp('/projects/prj_001', as(MANAGEMENT, { rights: { management: ['payment.view'] } }));
    await panel();
    expect(screen.queryByRole('button', { name: 'Add payment' })).toBeNull();
  });

  it('shows no panel without payment.view', async () => {
    await renderApp('/projects/prj_001', as(MANAGEMENT, { rights: { management: [] } }));
    await screen.findByRole('heading', { name: 'About' });
    expect(screen.queryByRole('heading', { name: 'Payments' })).toBeNull();
  });

  it('opens a payment as a read only sheet without payment.change, with no Save and no Delete', async () => {
    await renderApp('/projects/prj_001', as(MANAGEMENT, { rights: { management: ['payment.view'] } }));
    await panel();
    const rows = await screen.findAllByRole('button', { name: /^Open / });
    await userEvent.click(rows[0]);
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).queryByRole('button', { name: 'Save' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Mark as received' })).toBeNull();
  });

  it('shows Mark as received with payment.receive on an open payment, and no Delete', async () => {
    let name = '';
    await renderApp('/projects/prj_001', (state) => {
      as(MANAGEMENT, { rights: { management: ['payment.view', 'payment.receive'] } })(state);
      const payment = Object.values(state.payments ?? {}).find((item) => item.projectId === 'prj_001')!;
      payment.receivedOn = null;
      name = payment.name;
    });
    await panel();
    await userEvent.click(await screen.findByRole('button', { name: `Open payment ${name}` }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('button', { name: 'Mark as received' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
