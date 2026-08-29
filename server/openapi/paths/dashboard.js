import { op } from '../helpers.js';

export function dashboardPaths() {
  return {
    '/api/v1/dashboard': {
      get: op({
        summary: 'Get dashboard data',
        tag: 'Dashboard',
        description: 'Aggregated data for every overview tile. The two query parameters narrow what the page talks about, and they narrow the queries themselves - the task list caps at five while the metric tiles count without a limit, so filtering the response afterwards would disagree with itself. They apply to every task slice (`urgentTasks`, `openTaskCount`, `overdueTaskCount`, `memberTodayTasks`, `tasksDoneToday`) and to `upcomingEvents` respectively. Both are optional; the browser derives them from the per-widget `options` stored in `dashboard_widgets` (#814).',
        params: [
          {
            name: 'tasks_category',
            in: 'query',
            required: false,
            description: 'Limit tasks to these categories. Repeatable; several values combine with OR. Omitted or empty means every category.',
            schema: { type: 'array', items: { type: 'string' }, maxItems: 50 },
          },
          {
            name: 'events_scope',
            in: 'query',
            required: false,
            description: '`mine` limits appointments to those assigned to the calling user - among the assignees, so an unassigned event is not "mine" (same reading as the calendar module). Anything else means all appointments.',
            schema: { type: 'string', enum: ['all', 'mine'] },
          },
          {
            name: 'events_birthdays',
            in: 'query',
            required: false,
            description: '`hide` drops appointments that belong to a birthday entry from `upcomingEvents`, so a household that already shows the Birthdays tile does not read them twice. Applied before the five-item cap, so the freed rows are filled with the next real appointments. Anything else keeps them - birthdays are in by default.',
            schema: { type: 'string', enum: ['show', 'hide'] },
          },
        ],
      }),
    },
  };
}
