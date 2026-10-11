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

/* Global feed settings Save button and status message in the plugin settings. */
.extdatasrc-plugin-settings-feed-save-button {
  margin-top: 12px;
}

/* Space between the news source and game details sections. */
.extdatasrc-plugin-page > * + * {
  margin-top: 24px;
}

/* A text input below its label spans the field, like Steam's Target input. */
.extdatasrc-plugin-wide-input .DialogInput_Wrapper {
  flex: 1;
  min-width: 0;
}

/* Text stops before Steam's clear action instead of running under it. */
.extdatasrc-plugin-wide-input .DialogInput_Wrapper > input.DialogInput {
  padding-inline-end: 44px;
}

/*
 * Description or saved values in a row of their own below an input row; themes such as
 * Adwaita stretch the input over its row. Both rows join into one panel: themes draw rows
 * as separate cards (Steam, Fluenty) or as a list (Adwaita), so only the shared edge changes.
 */
.extdatasrc-plugin-page .Field.Panel.Background:has(+ .extdatasrc-plugin-field-continuation) {
  margin-bottom: 0 !important;
  border-bottom-width: 0 !important;
  border-bottom-left-radius: 0 !important;
  border-bottom-right-radius: 0 !important;
}

.extdatasrc-plugin-page .extdatasrc-plugin-field-continuation.Field.Panel.Background {
  margin-top: 0 !important;
  padding-top: 0 !important;
  border-top-width: 0 !important;
  border-top-left-radius: 0 !important;
  border-top-right-radius: 0 !important;
}

/* Validation message shown in place of a field description. */
.extdatasrc-plugin-field-error {
  color: #ff7070;
}

/* Year, month and day dropdowns of a game properties date field. */
.extdatasrc-plugin-date-controls {
  display: grid;
  grid-template-columns: 96px 140px 80px;
  gap: 8px;
  margin-left: auto;
}

/* Saved developer, publisher and tag values below their input row. */
.extdatasrc-plugin-token-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* A saved value; Steam store tags use the library filter's accent colour. */
.extdatasrc-plugin-token {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 2px 2px 10px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.1);
  color: #dcdedf;
  font-size: 13px;
  line-height: 20px;
}

.extdatasrc-plugin-token-store {
  background: #1a9fff;
  color: #fff;
}

.extdatasrc-plugin-token-label {
  overflow-wrap: anywhere;
}

.extdatasrc-plugin-token-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: transparent;
  color: inherit;
  font-size: 15px;
  cursor: pointer;
}

.extdatasrc-plugin-token-remove:hover,
.extdatasrc-plugin-token-remove.gpfocus {
  background: rgba(0, 0, 0, 0.25);
}

/* Store tag suggestions below or above the Tags input, rendered into the window body. */
.extdatasrc-plugin-tag-suggestions {
  position: fixed;
  z-index: 1000;
  box-sizing: border-box;
  padding: 4px 12px;
  overflow-y: auto;
  border-radius: 3px;
  background: #3d4450;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}

/* Load and save results below a section. */
.extdatasrc-plugin-form-status-message {
  margin-top: 12px;
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
