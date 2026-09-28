local millennium = require("millennium")
local json = require("json")
local http = require("http")

--- Constants for non-Steam AppID range
local NON_STEAM_APP_ID_MIN = 0x80000000
local NON_STEAM_APP_ID_MAX = 0xffffffff

-------------------------------------------------------------------------------
--- Internal Helper Functions                                               ---
-------------------------------------------------------------------------------

--- Validate and normalize a non-Steam AppID for use as a config key.
--- @param app_id string Non-Steam AppID
--- @return string key Decimal AppID without a prefix
local function nonSteamId(app_id)
    local n = tonumber(app_id)
    assert(n and n >= NON_STEAM_APP_ID_MIN and n <= NON_STEAM_APP_ID_MAX and n == math.floor(n), "Invalid non-Steam AppID")

    return string.format("%.0f", n)
end

--- Read the feed URL from an AppID's Millennium config object.
--- @param app_id string Non-Steam AppID
--- @return string url Configured URL, or an empty string when absent
local function getAppIdFeedUrl(app_id)
    local app, err = millennium.config.get(nonSteamId(app_id))
    assert(not err, err)

    return type(app) == "table" and type(app.feed) == "string" and app.feed or ""
end

--- Check whether a value is an HTTP or HTTPS feed URL without whitespace.
--- Yeah, this sucks, bla bla bla...
--- @param url any Value to check
--- @return boolean|string|nil valid Truthy for a valid URL
local function isValidUrl(url)
    return type(url) == "string" and url:match("^https?://[^/%s?#]+") and not url:find("[%s%c]")
end


-------------------------------------------------------------------------------
--- Backend Functions                                                       ---
-------------------------------------------------------------------------------

--- Remove a feed while preserving other fields under the same AppID.
--- @ffi
--- @param app_id string Non-Steam AppID
--- @return boolean success True after the feed is cleared
function clearFeedSource(app_id)
    local ok, err
    local key = nonSteamId(app_id)
    local app, read_err = millennium.config.get(key)
    assert(not read_err, read_err)

    --- AppID config not a table or feed not set
    --- That's okay, nothing to do, return early.
    if type(app) ~= "table" or app.feed == nil then
        return true
    end

    --- Clear feed
    app.feed = nil

    --- As an explainer: If we have multiple keys in the table
    --- we push the full config table again.
    --- However, if the feed was the only key in the table, we
    --- delete the entire config key from the table for that AppID.
    if next(app) then
        ok, err = millennium.config.set(key, app)
    else
        ok, err = millennium.config.delete(key)
    end
    assert(ok, err or "Could not remove feed source")

    return true
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

--- List configured feed URLs by non-Steam AppID.
--- @ffi
--- @return string sources JSON object mapping AppIDs to feed URLs
function getFeedSources()
    local sources = {}
    local config, err = millennium.config.get_all()
    assert(not err, err)

    --- Iterate through all config entries and collect valid feed URLs.
    --- This works by checking each config key of the plugin and validating
    --- that the key we have right now really is a non-Steam AppID.
    --- Otherwise we skip...
    for key, app in pairs(config) do
        local id = type(key) == "string" and key:match("^(%d+)$")
        local n  = id and tonumber(id)
        if n
            and n >= NON_STEAM_APP_ID_MIN
            and n <= NON_STEAM_APP_ID_MAX
            and type(app) == "table"
            and type(app.feed) == "string" then
            sources[id] = app.feed
        end
    end

    return json.encode(sources)
end

--- Save a feed URL while preserving other fields in the AppID's config object.
--- @ffi
--- @param app_id string Non-Steam AppID
--- @param url string HTTP or HTTPS feed URL
--- @return boolean success True after the config is saved
function saveFeedSource(app_id, url)
    assert(isValidUrl(url), "Enter an HTTP or HTTPS feed URL")

    local key = nonSteamId(app_id)
    local app, read_err = millennium.config.get(key)
    assert(not read_err, read_err)

    if type(app) ~= "table" then
        app = {}
    end

    app.feed = url

    local ok, err = millennium.config.set(key, app)
    assert(ok, err or "Could not save feed source")

    return true
end
