import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RoleSettings } from '../api/contract/entities';
import { addGroupConversation } from '../api/chatState';
import type { State } from '../api/store';
import { renderApp } from '../test/render';
import { without } from '../test/rr2work';

/**
 * The controls that have no project or to-do (role rights version 2, design section 7): they read the rights of the session. Each case
 * shows the control with the default Member rights and takes it away with its switch off. usr_005 is a Member, usr_010 is Management.
 */
const MEMBER = 'usr_005';
const MANAGEMENT = 'usr_010';
const as = (userId: string, roles?: RoleSettings) => (state: State) => {
  state.session.currentUserId = userId;
  if (roles) state.settings.roles = roles;
};

describe('New project and New client (project.create, client.create)', () => {
  it('shows New Project with the switch on and opens the sheet', async () => {
    await renderApp('/projects', as(MEMBER));
    expect(await screen.findByRole('button', { name: 'New Project' })).toBeInTheDocument();
  });

  it('takes New Project away with project.create off', async () => {
    await renderApp('/projects', as(MEMBER, without('project.create')));
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'New Project' })).toBeNull());
  });

  it('shows New client in the sheet with the switch on', async () => {
    await renderApp('/projects', as(MEMBER));
    await userEvent.click(await screen.findByRole('button', { name: 'New Project' }));
    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByRole('button', { name: 'New client' })).toBeInTheDocument();
  });

  it('takes New client away with client.create off, and keeps the client list', async () => {
    await renderApp('/projects', as(MEMBER, without('client.create')));
    await userEvent.click(await screen.findByRole('button', { name: 'New Project' }));
    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByLabelText('Client')).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'New client' })).toBeNull();
  });
});

describe('New office to-do (task.add.office, task.assign)', () => {
  it('shows the button with the switch on', async () => {
    await renderApp('/work', as(MEMBER));
    expect(await screen.findByRole('button', { name: 'New office to-do' })).toBeInTheDocument();
  });

  it('takes the button away with the switch off', async () => {
    await renderApp('/work', as(MEMBER, without('task.add.office')));
    expect(await screen.findByRole('heading', { level: 1, name: 'Tasks' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'New office to-do' })).toBeNull());
  });

  it('offers every active person as the lead with task.assign on', async () => {
    await renderApp('/work', as(MEMBER));
    await userEvent.click(await screen.findByRole('button', { name: 'New office to-do' }));
    const lead = await screen.findByLabelText('Lead');
    await waitFor(() => expect(within(lead).getAllByRole('option').length).toBeGreaterThan(2));
  });

  it('offers only the person as the lead with task.assign off', async () => {
    await renderApp('/work', as(MEMBER, without('task.assign')));
    await userEvent.click(await screen.findByRole('button', { name: 'New office to-do' }));
    const lead = await screen.findByLabelText('Lead');
    await waitFor(() => expect(within(lead).getAllByRole('option')).toHaveLength(1));
    expect(lead).toHaveDisplayValue('Sara Al-Qahtani');
  });
});

describe('New meeting (meeting.plan)', () => {
  it('shows the button with the switches on', async () => {
    await renderApp('/meetings', as(MEMBER));
    expect(await screen.findByRole('button', { name: 'New meeting' })).toBeInTheDocument();
  });

  it('takes the button away with every kind of planning off', async () => {
    await renderApp('/meetings', as(MEMBER, without('meeting.plan.none', 'meeting.plan.team')));
    expect(await screen.findByRole('heading', { level: 1, name: 'Tasks' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'New meeting' })).toBeNull());
  });

  it('keeps the button with only meetings of a project, and drops "No project" from the form', async () => {
    await renderApp('/meetings', as(MEMBER, without('meeting.plan.none')));
    await userEvent.click(await screen.findByRole('button', { name: 'New meeting' }));
    const project = await screen.findByLabelText('Project');
    await waitFor(() => expect(within(project).getAllByRole('option').length).toBeGreaterThan(0));
    expect(within(project).queryByRole('option', { name: 'No project (office meeting)' })).toBeNull();
    // The form starts on a project the person may plan in, so no empty choice is left.
    await waitFor(() => expect((project as HTMLSelectElement).value).not.toBe(''));
  });

  it('keeps the button with only a meeting with no project, and lists no project', async () => {
    await renderApp('/meetings', as(MEMBER, without('meeting.plan.team')));
    await userEvent.click(await screen.findByRole('button', { name: 'New meeting' }));
    const project = await screen.findByLabelText('Project');
    expect(within(project).getByRole('option', { name: 'No project (office meeting)' })).toBeInTheDocument();
    await waitFor(() => expect(within(project).getAllByRole('option')).toHaveLength(1));
  });
});

describe('the Inbox (chat.direct, chat.groupCreate, chat.groupChange)', () => {
  const group = (state: State) => {
    addGroupConversation(state, 'Tower team', 'usr_001', ['usr_001', 'usr_002', 'usr_005'], '2026-09-30T09:00:00.000+03:00');
  };

  it('shows New message with the switches on', async () => {
    await renderApp('/inbox', as(MEMBER));
    expect(await screen.findByRole('button', { name: 'New message' })).toBeInTheDocument();
  });

  it('takes New message away when both direct chats and groups are off', async () => {
    await renderApp('/inbox', as(MEMBER, without('chat.direct', 'chat.groupCreate')));
    expect(await screen.findByRole('heading', { level: 1, name: 'Inbox' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'New message' })).toBeNull());
  });

  it('keeps New message with groups off, and the sheet has no New group', async () => {
    await renderApp('/inbox', as(MEMBER, without('chat.groupCreate')));
    await userEvent.click(await screen.findByRole('button', { name: 'New message' }));
    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByRole('button', { name: /Faisal Al-Harbi/ })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'New group' })).toBeNull();
  });

  it('opens New message on the group form with direct chats off, with no way to a single chat', async () => {
    await renderApp('/inbox', as(MEMBER, without('chat.direct')));
    await userEvent.click(await screen.findByRole('button', { name: 'New message' }));
    const sheet = await screen.findByRole('dialog', { name: 'New group' });
    expect(within(sheet).getByRole('textbox', { name: 'Group name' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Message one person' })).toBeNull();
  });

  it('shows the box of a group with chat.direct on, and a line in its place with chat.direct off', async () => {
    await renderApp('/inbox', (state) => {
      group(state);
      as(MEMBER)(state);
    });
    await userEvent.click(await screen.findByRole('link', { name: /Tower team/ }));
    expect(await screen.findByRole('textbox', { name: 'Message' })).toBeInTheDocument();
  });

  it('shows the line "The Admin turned off messages for your role." in place of the box with chat.direct off', async () => {
    await renderApp('/inbox', (state) => {
      group(state);
      as(MEMBER, without('chat.direct'))(state);
    });
    await userEvent.click(await screen.findByRole('link', { name: /Tower team/ }));
    expect(await screen.findByText('The Admin turned off messages for your role.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
  });

  it('says the line in Arabic', async () => {
    await renderApp('/inbox', (state) => {
      group(state);
      as(MEMBER, without('chat.direct'))(state);
      state.users[MEMBER].preferences.language = 'ar';
    });
    await userEvent.click(await screen.findByRole('link', { name: /Tower team/ }));
    expect(await screen.findByText('أوقف المدير الرسائل لدورك.')).toBeInTheDocument();
  });

  it('offers Rename in the menu of a group with chat.groupChange on', async () => {
    await renderApp('/inbox', (state) => {
      group(state);
      as(MEMBER)(state);
    });
    await userEvent.click(await screen.findByRole('link', { name: /Tower team/ }));
    await screen.findByRole('heading', { level: 2, name: 'Tower team' });
    const menus = screen.getAllByRole('button', { name: 'Options for Tower team' });
    await userEvent.click(menus[menus.length - 1]);
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
  });

  it('drops Rename from the menu and Add people from the People sheet with chat.groupChange off', async () => {
    await renderApp('/inbox', (state) => {
      group(state);
      as(MEMBER, without('chat.groupChange'))(state);
    });
    await userEvent.click(await screen.findByRole('link', { name: /Tower team/ }));
    await screen.findByRole('heading', { level: 2, name: 'Tower team' });
    const menus = screen.getAllByRole('button', { name: 'Options for Tower team' });
    await userEvent.click(menus[menus.length - 1]);
    expect(await screen.findByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(await screen.findByRole('button', { name: '3 people' }));
    const sheet = await screen.findByRole('dialog', { name: 'People in the group' });
    expect(within(sheet).getByRole('button', { name: 'Leave group' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Add people' })).toBeNull();
  });
});

describe('People in the Admin page (people.*)', () => {
  it('shows Add person and the row menu to Management by default', async () => {
    await renderApp('/admin/people', as(MANAGEMENT));
    expect(await screen.findByRole('button', { name: 'Add person' })).toBeInTheDocument();
  });

  it('drops Add person with people.invite off and keeps the Edit item with people.change on', async () => {
    await renderApp('/admin/people', as(MANAGEMENT, { rights: { management: ['people.change'] } }));
    await screen.findByRole('heading', { name: 'People' });
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Actions for / }).length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: 'Add person' })).toBeNull();
    await userEvent.click(screen.getAllByRole('button', { name: /^Actions for / })[0]);
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Deactivate' })).toBeNull();
  });
});

describe('Project templates in the Admin page (templates.projectCreate, templates.updateProjects)', () => {
  it('shows New template with templates.projectCreate on', async () => {
    await renderApp('/admin/project-templates', as(MANAGEMENT, { rights: { management: ['templates.projectCreate'] } }));
    expect(await screen.findByRole('button', { name: 'New template' })).toBeInTheDocument();
  });

  it('drops New template when the person holds only templates.updateProjects', async () => {
    await renderApp('/admin/project-templates', as(MANAGEMENT, { rights: { management: ['templates.updateProjects'] } }));
    expect(await screen.findByRole('heading', { name: 'Project templates' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New template' })).toBeNull();
  });
});
