import { api } from '/api.js';
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';
import { toggleRowHtml } from '/settings/components.js';

let state = {
  settings: {
    active_week: 'all',
    view_mode: 'week',
    show_weekends: 0,
    show_school_holidays: 1,
  },
};

function renderPage(container, settings) {
  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', `
    <section class="settings-section">
      <h2 class="settings-section__title">${t('timetables.title')}</h2>
      <div class="settings-card">
        <h3 class="settings-card__title">${t('settings.timetablesViewTitle')}</h3>
        <p class="settings-card-description">${t('settings.timetablesViewDescription')}</p>

        <div class="form-group">
          ${toggleRowHtml({
            label: t('timetables.showSchoolHolidays'),
            checked: Boolean(settings.show_school_holidays),
            attrs: { id: 'timetable-setting-school-holidays' },
          })}
          <p class="form-hint">${t('timetables.showSchoolHolidaysHint')}</p>
        </div>

        <div class="form-group">
          ${toggleRowHtml({
            label: t('timetables.showWeekends'),
            checked: Boolean(settings.show_weekends),
            attrs: { id: 'timetable-setting-show-weekends' },
          })}
          <p class="form-hint">${t('timetables.showWeekendsHint')}</p>
        </div>

        <div class="form-group">
          <label class="form-label" for="timetable-setting-default-week">${t('timetables.defaultWeekType')}</label>
          <select class="form-input" id="timetable-setting-default-week">
            <option value="all" ${settings.active_week === 'all' ? 'selected' : ''}>${esc(t('timetables.allWeeks'))}</option>
            <option value="A" ${settings.active_week === 'A' ? 'selected' : ''}>${esc(t('timetables.weekA'))}</option>
            <option value="B" ${settings.active_week === 'B' ? 'selected' : ''}>${esc(t('timetables.weekB'))}</option>
          </select>
          <p class="form-hint">${t('timetables.defaultWeekTypeHint')}</p>
        </div>

        <div class="form-group">
          <label class="form-label" for="timetable-setting-view-mode">${t('timetables.viewMode')}</label>
          <select class="form-input" id="timetable-setting-view-mode">
            <option value="week" ${settings.view_mode === 'week' ? 'selected' : ''}>${esc(t('timetables.viewWeek'))}</option>
            <option value="day" ${settings.view_mode === 'day' ? 'selected' : ''}>${esc(t('timetables.viewDay'))}</option>
            <option value="list" ${settings.view_mode === 'list' ? 'selected' : ''}>${esc(t('timetables.viewList'))}</option>
          </select>
        </div>
      </div>
    </section>
  `);
}

function bindEvents(container, currentUserId) {
  const holidaysToggle = container.querySelector('#timetable-setting-school-holidays');
  const weekendsToggle = container.querySelector('#timetable-setting-show-weekends');
  const weekSelect = container.querySelector('#timetable-setting-default-week');
  const viewSelect = container.querySelector('#timetable-setting-view-mode');

  async function save() {
    try {
      const payload = {
        user_id: currentUserId,
        show_school_holidays: holidaysToggle.checked ? 1 : 0,
        show_weekends: weekendsToggle.checked ? 1 : 0,
        active_week: weekSelect.value,
        view_mode: viewSelect.value,
      };
      await api.put('/timetables/settings', payload);
      window.yuvomi?.showToast(t('common.saved'), 'success');
    } catch (err) {
      window.yuvomi?.showToast(err.message || t('common.errorGeneric'), 'danger');
    }
  }

  holidaysToggle?.addEventListener('change', save);
  weekendsToggle?.addEventListener('change', save);
  weekSelect?.addEventListener('change', save);
  viewSelect?.addEventListener('change', save);
}

export async function render(container, { user } = {}) {
  const userId = user?.id;
  try {
    const res = await api.get(`/timetables/settings${userId ? `?user_id=${userId}` : ''}`);
    state.settings = res?.settings || state.settings;
  } catch {
    // fallback to defaults
  }
  renderPage(container, state.settings);
  bindEvents(container, userId);
}
