(function (global) {
  'use strict';

  const OMSA = global.OMSA || (global.OMSA = {});

  const HOURS_MINUTES = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const dateFormats = {};

  const partsOf = (format, date) => Object.fromEntries(format.formatToParts(date).map((p) => [p.type, p.value]));

  function time(iso) {
    const parts = partsOf(HOURS_MINUTES, new Date(iso));
    return parts.hour + ':' + parts.minute;
  }

  function appZone() {
    const meta = global.document.querySelector('meta[name="app-timezone"]');
    return meta ? meta.content : undefined;
  }

  function dateKey(zone, date) {
    if (!dateFormats[zone]) {
      dateFormats[zone] = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
    }
    const parts = partsOf(dateFormats[zone], date);
    return parts.year + '-' + parts.month + '-' + parts.day;
  }

  const appToday = () => dateKey(appZone(), new Date());

  OMSA.time = { time, appZone, dateKey, appToday };
})(window);
