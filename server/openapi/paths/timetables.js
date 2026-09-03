import { op, jsonBody, idParam } from '../helpers.js';

export function timetablesPaths() {
  return {
    '/api/v1/timetables': {
      get: op({
        summary: 'List timetable entries',
        description: 'Returns recurring weekly school and work timetable entries per member.',
        tag: 'Timetables',
        params: [
          { name: 'user_id', in: 'query', required: false, description: 'Filter by member ID', schema: { type: 'integer' } },
          { name: 'day_of_week', in: 'query', required: false, description: '1 (Monday) to 7 (Sunday)', schema: { type: 'integer' } },
          { name: 'week_type', in: 'query', required: false, description: 'all | A | B', schema: { type: 'string' } },
        ],
      }),
      post: op({
        summary: 'Create a timetable entry',
        description: 'Creates a lesson, work slot or activity for a member.',
        tag: 'Timetables',
        stateChanging: true,
        requestBody: jsonBody(null),
      }),
    },
    '/api/v1/timetables/today': {
      get: op({
        summary: 'Get today timetable entries',
        description: 'Returns timetable slots scheduled for the current day.',
        tag: 'Timetables',
        params: [
          { name: 'user_id', in: 'query', required: false, description: 'Filter by member ID', schema: { type: 'integer' } },
          { name: 'week_type', in: 'query', required: false, description: 'Filter by week type (A or B)', schema: { type: 'string' } },
        ],
      }),
    },
    '/api/v1/timetables/settings': {
      get: op({
        summary: 'Get timetable settings for a user',
        tag: 'Timetables',
        params: [
          { name: 'user_id', in: 'query', required: false, description: 'Member ID', schema: { type: 'integer' } },
        ],
      }),
      put: op({
        summary: 'Update timetable settings for a user',
        tag: 'Timetables',
        stateChanging: true,
        requestBody: jsonBody(null),
      }),
    },
    '/api/v1/timetables/{id}': {
      get: op({ summary: 'Get a timetable entry', tag: 'Timetables', params: [idParam()] }),
      put: op({ summary: 'Update a timetable entry', tag: 'Timetables', params: [idParam()], stateChanging: true, requestBody: jsonBody(null) }),
      delete: op({ summary: 'Delete a timetable entry', tag: 'Timetables', params: [idParam()], stateChanging: true }),
    },
    '/api/v1/timetables/copy': {
      post: op({
        summary: 'Copy timetable entries from one user to another',
        tag: 'Timetables',
        stateChanging: true,
        requestBody: jsonBody(null),
      }),
    },
  };
}
