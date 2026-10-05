// Starlight cannot bundle .css imports; keep the styles as bundled strings.
export const uiCss = `
/* Section selector header and content area in Millennium's plugin settings sidebar. */
.extdatasrc-plugin-settings-section-selector,
.extdatasrc-plugin-settings-content {
  padding-inline: 0;
}

/* General settings hint and feed settings panel in Millennium's plugin settings. */
.extdatasrc-plugin-settings-panel {
  width: 100%;
}

/* Inactive general or feed settings panel in Millennium's plugin settings. */
.extdatasrc-plugin-settings-panel-hidden {
  display: none;
}

/* Feed refresh interval input in the plugin's global feed settings. */
.extdatasrc-plugin-settings-feed-refresh-interval-input {
  width: 44px;
}

/* Simultaneous feed fetch count input in the plugin's global feed settings. */
.extdatasrc-plugin-settings-feed-concurrency-input {
  width: 24px;
}

/* Global feed settings Save button and status messages in settings and game properties. */
.extdatasrc-plugin-settings-feed-save-button,
.extdatasrc-plugin-form-status-message {
  margin-top: 12px;
}

/* News source and game details headers and control sections in game properties. */
.extdatasrc-plugin-news-source-header,
.extdatasrc-plugin-news-source-controls,
.extdatasrc-plugin-game-details-header,
.extdatasrc-plugin-game-details-date-section {
  flex-shrink: 0;
}

/* Year, month and day dropdown row for release and library addition dates in game properties. */
.extdatasrc-plugin-game-details-date-controls {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
  min-width: 0;
}

/* Year dropdown container in each game properties date field. */
.extdatasrc-plugin-game-details-date-year {
  width: 110px;
}

/* Month dropdown container in each game properties date field. */
.extdatasrc-plugin-game-details-date-month {
  width: 160px;
}

/* Day dropdown container in each game properties date field. */
.extdatasrc-plugin-game-details-date-day {
  width: 90px;
}

/* Developer, publisher and tag editor groups in the external game details section. */
.extdatasrc-plugin-game-details-list-editor {
  flex-shrink: 0;
  min-width: 0;
  display: grid;
  margin-top: 6px;
}

/* Native Steam field background underneath each developer, publisher and tag editor. */
.extdatasrc-plugin-game-details-list-editor-background {
  grid-area: 1 / 1;
  display: grid;
  pointer-events: none;
}

/* Label above the input in each developer, publisher and tag editor. */
.extdatasrc-plugin-game-details-list-editor-label {
  position: absolute;
  top: 12px;
  left: 12px;
}

/* Input controls and saved entries overlaid on each native list editor background. */
.extdatasrc-plugin-game-details-list-editor-content {
  grid-area: 1 / 1;
  position: relative;
  min-width: 0;
  padding: 40px 12px 12px;
}

/* Text input container beside the Add button in developer, publisher and tag editors. */
.extdatasrc-plugin-game-details-list-editor-input {
  flex: 1;
  min-width: 0;
  padding: 0;
}

/* Saved developer names, publisher names and tags below their respective inputs. */
.extdatasrc-plugin-game-details-saved-entry-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}

/* Saved developer or publisher row containing a company name and its Remove button. */
.extdatasrc-plugin-game-details-company-row {
  gap: 8px;
}

/* Company names and tag labels in the saved game details lists. */
.extdatasrc-plugin-game-details-entry-label {
  overflow-wrap: anywhere;
}

/* Remove button beside each saved developer or publisher name. */
.extdatasrc-plugin-game-details-company-remove-button {
  padding: 0 8px;
  min-width: 0;
}

/* Store tag suggestion popup above or below the Tags input, rendered into the window body. */
.extdatasrc-plugin-game-details-tag-suggestions-popup {
  position: fixed;
  padding: 0;
  z-index: 1000;
}

/* Scrollable checkbox list inside the store tag suggestion popup. */
.extdatasrc-plugin-game-details-tag-suggestions-list {
  position: relative;
  top: 0;
  height: auto;
  visibility: visible;
  pointer-events: auto;
  overflow-y: auto;
}

/* Wrapping row of saved tag chips below the Tags input. */
.extdatasrc-plugin-game-details-tag-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

/* Individual saved store or custom tag chip in external game details. */
.extdatasrc-plugin-game-details-tag-chip {
  border-radius: 12px;
  padding: 1px 3px 1px 8px;
  gap: 4px;
  font-size: 12px;
}

/* Background of user-defined tag chips that are not linked to Steam store tag IDs. */
.extdatasrc-plugin-game-details-custom-tag-chip {
  background: rgba(255, 255, 255, 0.08);
}

/* Circular Remove button inside each saved tag chip. */
.extdatasrc-plugin-game-details-tag-remove-button {
  padding: 0;
  min-width: 0;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: inherit;
}
`;

export const activityImageCss = `
/* Article images in external news activity sections in the Steam library. */
[data-external-news-activity] .PartnerEventMediumImage_Image {
  width: 100%; height: auto; aspect-ratio: 16 / 9; object-fit: cover; display: block;
}
`;

export const whatsNewImageCss = `
/* News carousel images on the library home page in Desktop mode and the home screen in Big Picture. */
.EventRowCarousel img.PartnerEventRowCapsule_MainImage, /* Desktop Client */
.BasicHomeUpdates .EventCarousel img.EventImage { /* Big Picture */
  aspect-ratio: 16 / 9;
  object-fit: cover;
}
`;
