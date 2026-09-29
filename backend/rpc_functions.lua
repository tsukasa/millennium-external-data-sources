local millennium = require("millennium")
local json = require("json")
local http = require("http")


-------------------------------------------------------------------------------
--- Constants                                                               ---
-------------------------------------------------------------------------------

local NON_STEAM_APP_ID_MIN = 0x80000000
local NON_STEAM_APP_ID_MAX = 0xffffffff

local FEED_INTERVAL_MIN = 10
local FEED_INTERVAL_MAX = 360
local FEED_CONCURRENCY_MIN = 1
local FEED_CONCURRENCY_MAX = 8
local FEED_ITEMS_MAX = 5
local FEED_ITEMS_DEFAULT = 3
local RELEASE_YEAR_MIN = 1960


-------------------------------------------------------------------------------
--- Internal Helper Functions                                               ---
-------------------------------------------------------------------------------

--- Validate and normalize a non-Steam AppID for use as a config key.
--- @param app_id string Non-Steam AppID
--- @return string key Decimal AppID without a prefix
local function nonSteamId(app_id)
    local n = tonumber(app_id)

    assert(n
        and n >= NON_STEAM_APP_ID_MIN
        and n <= NON_STEAM_APP_ID_MAX
        and n == math.floor(n),
        "Invalid non-Steam AppID"
    )

    return string.format("%.0f", n)
end

--- Read and write only this app's config while preserving unrelated fields.
--- @param app_id string Non-Steam AppID
--- @return table app Configuration object for the app, or an empty table if none exists
--- @return string key Non-Steam AppID key used for the config
local function readAppConfig(app_id)
    local key = nonSteamId(app_id)
    local app, err = millennium.config.get(key)

    assert(not err, err)

    return type(app) == "table" and app or {}, key
end

--- Write an AppID-specific configuration for a non-Steam app. Deletes the config if empty.
--- @param key string Non-Steam AppID key
--- @param app table Configuration object for the app
--- @param message string Error message to use if the operation fails
--- @return boolean success True if the operation succeeded
local function writeAppConfig(key, app, message)
    local ok, err

    if next(app) then
        ok, err = millennium.config.set(key, app)
    else
        ok, err = millennium.config.delete(key)
    end

    assert(ok, err or message)

    return true
end

--- Retrieve all AppID-specific configurations for non-Steam apps.
--- @return table<string, table> Mapping of non-Steam AppIDs to their config objects
local function appConfigs()
    local config, err = millennium.config.get_all()
    local apps = {}

    assert(not err, err)

    for key, app in pairs(config) do
        local id = type(key) == "string" and key:match("^(%d+)$")
        local n = id and tonumber(id)

        if n and n >= NON_STEAM_APP_ID_MIN and n <= NON_STEAM_APP_ID_MAX
            and type(app) == "table" then
            apps[id] = app
        end
    end

    return apps
end

--- Validate the item limit for a feed in the Millennium config.
--- @param value any Value to validate
--- @return boolean valid Truthy if the value is a valid item limit
local function validItemLimit(value)
    return type(value) == "number"
        and value >= 0
        and value <= FEED_ITEMS_MAX
        and value == math.floor(value)
end

--- Read the feed URL from an AppID's Millennium config object.
--- @param app_id string Non-Steam AppID
--- @return string url Configured URL, or an empty string when absent
local function getAppIdFeedUrl(app_id)
    local app = readAppConfig(app_id)
    return type(app.feed) == "string" and app.feed or ""
end

--- Check whether a value is an HTTP or HTTPS feed URL without whitespace.
--- @param url any Value to check
--- @return boolean|string|nil valid Truthy for a valid URL
local function isValidUrl(url)
    return type(url) == "string"
        and url:match("^https?://[^/%s?#]+")
        and not url:find("[%s%c]")
end

--- A calendar date stored without a time or timezone.
--- @param date table Table containing year, month, and day fields
--- @return boolean valid Truthy if the date is valid
local function isValidReleaseDate(date)
    if type(date) ~= "table" then
        return false
    end

    local year, month, day = date.year, date.month, date.day
    if type(year) ~= "number"
        or type(month) ~= "number"
        or type(day) ~= "number"
        or year ~= math.floor(year)
        or month ~= math.floor(month)
        or day ~= math.floor(day)
        or year < RELEASE_YEAR_MIN or year > os.date("*t").year + 1
        or month < 1 or month > 12 then
        return false
    end

    local daysPerMonth = { 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 }

    -- Properly account for leap years
    if month == 2 and (year % 400 == 0 or (year % 4 == 0 and year % 100 ~= 0)) then
        daysPerMonth[2] = 29
    end

    return day >= 1 and day <= daysPerMonth[month]
end


-------------------------------------------------------------------------------
--- Backend Functions                                                       ---
-------------------------------------------------------------------------------

--- Remove a feed while preserving other fields under the same AppID.
--- @ffi
--- @param app_id string Non-Steam AppID
--- @return boolean success True after the feed is cleared
function clearFeedSource(app_id)
    local app, key = readAppConfig(app_id)

    if app.feed == nil and app.showFeedInWhatsNew == nil and app.maxItemsFromFeedInWhatsNew == nil then
        return true
    end

    app.feed = nil
    app.showFeedInWhatsNew = nil
    app.maxItemsFromFeedInWhatsNew = nil

    return writeAppConfig(key, app, "Could not remove feed source")
end

--- Fetch the configured feed and return its source URL and XML body.
--- @ffi
--- @param app_id string Non-Steam AppID
--- @return string response JSON object containing url and xml
function fetchFeed(app_id)
    local url = getAppIdFeedUrl(app_id)

    assert(isValidUrl(url), "No valid feed configured")

    local response, err = http.get(url, {
        timeout = 15,
        headers = { Accept = "application/atom+xml,application/rss+xml,application/xml,text/xml" },
    })

    assert(response, err or "Feed request failed")
    assert(response.status >= 200 and response.status < 300, "Feed HTTP error " .. tostring(response.status))
    assert(type(response.body) == "string" and #response.body > 0, "Feed response is empty")

    return json.encode({ url = url, xml = response.body })
end

--- List configured feed settings by non-Steam AppID.
--- @ffi
--- @return string sources JSON object mapping AppIDs to feed settings
function getFeedSources()
    local sources = {}

    for id, app in pairs(appConfigs()) do
        if type(app.feed) == "string"
            or type(app.showFeedInWhatsNew) == "boolean"
            or type(app.maxItemsFromFeedInWhatsNew) == "number" then
            sources[id] = {
                url = type(app.feed) == "string" and app.feed or "",
                showFeedInWhatsNew = app.showFeedInWhatsNew ~= false,
                maxItemsFromFeedInWhatsNew = validItemLimit(app.maxItemsFromFeedInWhatsNew)
                    and app.maxItemsFromFeedInWhatsNew or FEED_ITEMS_DEFAULT,
            }
        end
    end

    return json.encode(sources)
end

--- List configured release dates by non-Steam AppID.
--- @ffi
--- @return string dates JSON object mapping AppIDs to calendar dates
function getReleaseDates()
    local dates = {}

    for id, app in pairs(appConfigs()) do
        if isValidReleaseDate(app.releaseDate) then
            dates[id] = app.releaseDate
        end
    end

    return json.encode(dates)
end

--- Save a calendar date as one structured value in the AppID config.
--- @ffi
--- @param app_id string Non-Steam AppID
--- @param year number Calendar year
--- @param month number Calendar month, one through twelve
--- @param day number Day of the month
--- @return boolean success True after the config is saved
function setReleaseDate(app_id, year, month, day)
    local date = { year = year, month = month, day = day }

    assert(isValidReleaseDate(date), "Invalid release date")

    local app, key = readAppConfig(app_id)
    app.releaseDate = date

    return writeAppConfig(key, app, "Could not save release date")
end

--- Remove only the release date and preserve other AppID settings.
--- @ffi
--- @param app_id string Non-Steam AppID
--- @return boolean success True after the config is cleared
function clearReleaseDate(app_id)
    local app, key = readAppConfig(app_id)

    if app.releaseDate == nil then
        return true
    end

    app.releaseDate = nil

    return writeAppConfig(key, app, "Could not remove release date")
end

--- Read global feed settings.
--- @ffi
--- @return string settings JSON object with refresh interval and fetch concurrency
function getFeedSettings()
    local settings, err = millennium.config.get("feedSettings")

    assert(not err, err)

    settings = type(settings) == "table" and settings or {}

    return json.encode({
        refreshIntervalMinutes = settings.refreshIntervalMinutes,
        concurrentFetches = settings.concurrentFetches,
    })
end

--- Save global feed refresh settings.
--- @ffi
--- @param interval_minutes number Refresh interval in minutes (at least ten)
--- @param concurrent_fetches number Maximum simultaneous background fetches
--- @return boolean success True after the config is saved
function setFeedSettings(interval_minutes, concurrent_fetches)
    assert(type(interval_minutes) == "number"
        and interval_minutes >= FEED_INTERVAL_MIN
        and interval_minutes <= FEED_INTERVAL_MAX
        and interval_minutes == math.floor(interval_minutes),
        "Invalid feed refresh interval")

    assert(type(concurrent_fetches) == "number"
        and concurrent_fetches >= FEED_CONCURRENCY_MIN
        and concurrent_fetches <= FEED_CONCURRENCY_MAX
        and concurrent_fetches == math.floor(concurrent_fetches),
        "Invalid concurrent fetch count")

    local ok, err = millennium.config.set("feedSettings", {
        refreshIntervalMinutes = interval_minutes,
        concurrentFetches = concurrent_fetches,
    })

    assert(ok, err or "Could not save feed settings")

    return true
end

--- List article URLs removed from What's New.
--- @ffi
--- @return string urls JSON array of removed article URLs
function getFeedRemovedItems()
    local items, err = millennium.config.get("feedRemovedItems")

    assert(not err, err)
    assert(items == nil or type(items) == "table", "Invalid removed feed items")

    return json.encode(items or {})
end

--- Persist a removed article URL once, without touching per-AppID settings.
--- @ffi
--- @param url string Article URL
--- @return boolean success True after the URL is stored
function addFeedRemovedItem(url)
    assert(isValidUrl(url), "Invalid article URL")

    local items, read_err = millennium.config.get("feedRemovedItems")

    assert(not read_err, read_err)
    assert(items == nil or type(items) == "table", "Invalid removed feed items")

    items = items or {}

    for _, existing in ipairs(items) do
        if existing == url then
            return true
        end
    end

    items[#items + 1] = url

    local ok, err = millennium.config.set("feedRemovedItems", items)

    assert(ok, err or "Could not save removed feed item")

    return true
end

--- Save feed settings while preserving other fields in the AppID's config object.
--- @ffi
--- @param app_id string Non-Steam AppID
--- @param url string HTTP or HTTPS feed URL
--- @param show_in_whats_new boolean Whether the feed appears in What's New
--- @param max_items_from_feed_in_whats_new number The maximum number of items from the feed that can appear in What's New
--- @return boolean success True after the config is saved
function saveFeedSource(app_id, url, show_in_whats_new, max_items_from_feed_in_whats_new)
    assert(isValidUrl(url), "Enter an HTTP or HTTPS feed URL")
    assert(type(show_in_whats_new) == "boolean", "Invalid What's New setting")
    assert(validItemLimit(max_items_from_feed_in_whats_new), "Invalid What's New item limit")

    local app, key = readAppConfig(app_id)

    app.feed = url
    app.showFeedInWhatsNew = show_in_whats_new
    app.maxItemsFromFeedInWhatsNew = max_items_from_feed_in_whats_new

    return writeAppConfig(key, app, "Could not save feed source")
end

--- Save only the What's New setting, preserving the feed URL and other fields.
--- @ffi
--- @param app_id string Non-Steam AppID
--- @param show_in_whats_new boolean Whether the feed appears in What's New
--- @return boolean success True after the setting is saved
function setShowFeedInWhatsNew(app_id, show_in_whats_new)
    assert(type(show_in_whats_new) == "boolean", "Invalid What's New setting")

    local app, key = readAppConfig(app_id)

    app.showFeedInWhatsNew = show_in_whats_new

    return writeAppConfig(key, app, "Could not save What's New setting")
end

--- Save only the per-feed What's New item limit.
--- @ffi
--- @param app_id string Non-Steam AppID
--- @param max_items number Zero for unlimited, otherwise one through five
--- @return boolean success True after the setting is saved
function setMaxItemsFromFeedInWhatsNew(app_id, max_items)
    assert(validItemLimit(max_items), "Invalid What's New item limit")

    local app, key = readAppConfig(app_id)

    app.maxItemsFromFeedInWhatsNew = max_items

    return writeAppConfig(key, app, "Could not save What's New item limit")
end
