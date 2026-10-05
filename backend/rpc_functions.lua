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
local GAME_DETAIL_FIELDS = {
    releaseDate        = true,
    addedToLibraryDate = true,
    developer          = true,
    publisher          = true,
    tags               = true
}


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

--- Validate a timezone-free ISO calendar date.
--- @param date any Date to validate
--- @return boolean valid Whether the date is valid
local function isValidCalendarDate(date)
    -- It is possible we have old values from < v0.1.2 stored
    -- as tables rather than strings.
    -- Ignore these values and report them as false.
    if type(date) ~= "string" then
        return false
    end

    local year, month, day = date:match("^(%d%d%d%d)%-(%d%d)%-(%d%d)$")
    year, month, day = tonumber(year), tonumber(month), tonumber(day)

    if not year or year < RELEASE_YEAR_MIN or year > os.date("*t").year + 1
        or month < 1 or month > 12 then
        return false
    end

    local daysPerMonth = { 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 }

    if month == 2 and (year % 400 == 0 or (year % 4 == 0 and year % 100 ~= 0)) then
        daysPerMonth[2] = 29
    end

    return day >= 1 and day <= daysPerMonth[month]
end

--- Helper function to normalize and validate lists of names.
--- @param value string|table A single name or a list of names
--- @return table A list of unique, trimmed names
local function listNames(value, allowTagIds)
    if type(value) == "string" then
        value = { value }
    end

    assert(type(value) == "table", "Invalid name list")

    local names, seen, count = {}, {}, 0

    for key, name in pairs(value) do
        local validIndex = type(key) == "number" and key >= 1 and key <= #value and key == math.floor(key)
        local validTagId = allowTagIds and type(name) == "number"
            and name > 0 and name <= 9007199254740991 and name == math.floor(name)
        local validName = type(name) == "string" or validTagId
        assert(validIndex and validName, "Invalid name list")
        count = count + 1
    end

    assert(count == #value, "Invalid name list")

    for _, name in ipairs(value) do
        if type(name) == "string" then
            name = name:match("^%s*(.-)%s*$")
        end

        if name ~= "" and not seen[name] then
            names[#names + 1], seen[name] = name, true
        end
    end

    return names
end

-------------------------------------------------------------------------------
--- Exported Backend FFI Functions                                          ---
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

--- List valid game details by non-Steam AppID. Legacy date objects are not migrated.
--- @ffi
--- @return string details JSON object mapping AppIDs to game details
function getGameDetails()
    local details = {}

    for id, app in pairs(appConfigs()) do
        local entry = {}

        for field in pairs(GAME_DETAIL_FIELDS) do
            local value = app[field]

            if field == "developer" or field == "publisher" or field == "tags" then
                local ok, names = pcall(listNames, value, field == "tags")

                if ok and #names > 0 then
                    entry[field] = names
                end
            elseif isValidCalendarDate(value) then
                entry[field] = value
            end
        end

        if next(entry) then
            details[id] = entry
        end
    end

    return json.encode(details)
end

--- Save or clear one override while preserving feed and other game details.
--- @ffi
--- @param app_id string Non-Steam AppID
--- @param field string Game detail field to update
--- @param value string|table ISO date or JSON array of names; empty date/array clears
--- @return boolean success True after the config is saved
function setGameDetail(app_id, field, value)
    assert(type(field) == "string" and GAME_DETAIL_FIELDS[field], "Invalid game detail field")
    assert(type(value) == "string", "Invalid game detail value")

    if field == "developer" or field == "publisher" or field == "tags" then
        local decoded = json.decode(value)
        assert(type(decoded) == "table", "Invalid name list")

        value = listNames(decoded, field == "tags")

        if #value == 0 then
            value = nil
        end
    else
        value = value:match("^%s*(.-)%s*$")
        assert(value == "" or isValidCalendarDate(value), "Invalid calendar date")

        if value == "" then
            value = nil
        end
    end

    local app, key = readAppConfig(app_id)
    app[field] = value

    return writeAppConfig(key, app, "Could not save game details")
end

--- Clear all game detail overrides after a shortcut is removed.
--- @ffi
--- @param app_id string Non-Steam AppID
--- @return boolean success True after the config is cleared
function clearGameDetails(app_id)
    local app, key = readAppConfig(app_id)

    for field in pairs(GAME_DETAIL_FIELDS) do
        app[field] = nil
    end

    return writeAppConfig(key, app, "Could not remove game details")
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
