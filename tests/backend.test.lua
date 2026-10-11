-- Run from the repository root: lua tests/backend.test.lua
local config = {}
local failWrites = false

local function copy(value)
    if type(value) ~= "table" then return value end
    local result = {}
    for key, item in pairs(value) do result[key] = copy(item) end
    return result
end

package.preload.millennium = function()
    return { config = {
        get = function(key) return copy(config[key]) end,
        get_all = function() return copy(config) end,
        set = function(key, value)
            if failWrites then return false, "disk error" end
            config[key] = copy(value)
            return true
        end,
        delete = function(key)
            if failWrites then return false, "disk error" end
            config[key] = nil
            return true
        end,
    } }
end
package.preload.json = function() return {
    encode = function(value) return value end,
    decode = function(value)
        local fixtures = {
            ['["  Studio  ","Second Studio","Studio"]'] = { "  Studio  ", "Second Studio", "Studio" },
            ['["Publisher"]'] = { "Publisher" },
            ['["Changed"]'] = { "Changed" },
            ['[" RPG ","Co-op","RPG"]'] = { " RPG ", "Co-op", "RPG" },
            ['[19,4182,"Custom",19]'] = { 19, 4182, "Custom", 19 },
            ['[-1]'] = { -1 }, ['[1.5]'] = { 1.5 }, ['[0]'] = { 0 },
            ['[]'] = {}, ['[1]'] = { 1 }, ['{"name":"Studio"}'] = { name = "Studio" },
        }
        return copy(fixtures[value])
    end,
} end
package.preload.http = function()
    return { get = function() error("Settings must not request HTTP") end }
end

dofile("backend/rpc_functions.lua")
local id = "4066412613"
local other = "3900360037"
config[id] = { custom = "keep", releaseDate = { year = 2004, month = 11, day = 23 } }
config[other] = { feed = "https://other.test/feed" }
config["570"] = { feed = "https://steam.test/feed", releaseDate = { year = 2020, month = 1, day = 1 } }

assert(saveFeedSource(id, "https://example.com/feed", false, 0))
assert(config[id].custom == "keep" and config[id].releaseDate.year == 2004)
assert(getFeedSources()[id].maxItemsFromFeedInWhatsNew == 0)
assert(getFeedSources()["570"] == nil and getGameDetails()["570"] == nil)
assert(setShowFeedInWhatsNew(id, true))
assert(setMaxItemsFromFeedInWhatsNew(id, 5))
assert(config[id].feed == "https://example.com/feed" and config[id].releaseDate.day == 23)
assert(clearFeedSource(id))
assert(config[id].feed == nil and config[id].showFeedInWhatsNew == nil and config[id].maxItemsFromFeedInWhatsNew == nil)
assert(config[id].releaseDate.year == 2004 and config[id].custom == "keep")
assert(config[other].feed == "https://other.test/feed")

assert(getGameDetails()[id] == nil) -- Legacy date objects remain untouched until overwritten.
assert(setGameDetail(id, "releaseDate", "2024-02-29"))
assert(config[id].releaseDate == "2024-02-29" and config[id].custom == "keep")
assert(not pcall(setGameDetail, id, "releaseDate", "2025-02-29"))
assert(setGameDetail(id, "releaseDate", "1960-01-01"))
assert(setGameDetail(id, "releaseDate", (os.date("*t").year + 1) .. "-12-31"))
assert(not pcall(setGameDetail, id, "releaseDate", "1959-12-31"))
assert(not pcall(setGameDetail, id, "releaseDate", (os.date("*t").year + 2) .. "-01-01"))
assert(setGameDetail(id, "releaseDate", "2024-02-29"))
assert(config[id].releaseDate == "2024-02-29")
assert(saveFeedSource(id, "https://example.com/feed", true, 3))
assert(clearGameDetails(id))
assert(config[id].releaseDate == nil and config[id].feed == "https://example.com/feed")
assert(clearFeedSource(id))
assert(config[id].custom == "keep")
config[id] = nil
assert(setGameDetail(id, "releaseDate", "2026-10-01"))
assert(clearGameDetails(id) and config[id] == nil)
assert(clearGameDetails(id) and clearFeedSource(id))
assert(saveFeedSource(id, "https://example.com/feed", true, 3))
assert(clearFeedSource(id) and config[id] == nil)

assert(setFeedSettings(10, 1))
assert(setFeedSettings(360, 8))
for _, value in ipairs({ 9, 361, 15.5 }) do
    assert(not pcall(setFeedSettings, value, 2))
end
for _, value in ipairs({ 0, 9, 2.5 }) do
    assert(not pcall(setFeedSettings, 10, value))
end
assert(config.feedSettings.refreshIntervalMinutes == 360 and config.feedSettings.concurrentFetches == 8)
assert(not pcall(setGameDetail, "570", "releaseDate", "2026-10-01"))
assert(not pcall(setMaxItemsFromFeedInWhatsNew, id, 6))

assert(saveFeedSource(id, "https://example.com/feed", true, 3))
failWrites = true
assert(not pcall(setGameDetail, id, "releaseDate", "2026-10-01"))
assert(not pcall(clearFeedSource, id))
assert(config[id].releaseDate == nil and config[id].feed == "https://example.com/feed")
failWrites = false
assert(clearFeedSource(id) and config[id] == nil)

-- Partial writes, strict ISO validation, company names and removal of every override.
assert(setGameDetail(id, "addedToLibraryDate", "2020-01-15"))
assert(setGameDetail(id, "tags", '[" RPG ","Co-op","RPG"]'))
assert(#config[id].tags == 2 and getGameDetails()[id].tags[1] == "RPG")
assert(getGameDetails()[id].tags[2] == "Co-op")
assert(setGameDetail(id, "tags", '[19,4182,"Custom",19]'))
assert(#config[id].tags == 3 and config[id].tags[1] == 19)
assert(getGameDetails()[id].tags[2] == 4182 and getGameDetails()[id].tags[3] == "Custom")
assert(not pcall(setGameDetail, id, "tags", '[-1]'))
assert(not pcall(setGameDetail, id, "tags", '[1.5]'))
assert(not pcall(setGameDetail, id, "tags", '[0]'))
assert(not pcall(setGameDetail, id, "tags", '{"name":"Studio"}'))
assert(setGameDetail(id, "developer", '["  Studio  ","Second Studio","Studio"]'))
assert(setGameDetail(id, "publisher", '["Publisher"]'))
assert(getGameDetails()[id].developer[1] == "Studio" and getGameDetails()[id].developer[2] == "Second Studio")
assert(#config[id].developer == 2)
assert(not pcall(setGameDetail, id, "developer", '[1]'))
assert(not pcall(setGameDetail, id, "developer", '{"name":"Studio"}'))
assert(getGameDetails()[id].addedToLibraryDate == "2020-01-15")
assert(not pcall(setGameDetail, id, "addedToLibraryDate", "2024-02-30"))
assert(not pcall(setGameDetail, id, "releaseDate", "2024-2-29"))
assert(not pcall(setGameDetail, id, "releaseDate", { year = 2024, month = 2, day = 29 }))
assert(not pcall(setGameDetail, id, "feed", "https://example.com"))
assert(setGameDetail(id, "developer", "[]"))
assert(config[id].developer == nil and config[id].publisher[1] == "Publisher")
assert(saveFeedSource(id, "https://example.com/feed", true, 3))
failWrites = true
assert(not pcall(setGameDetail, id, "publisher", '["Changed"]'))
assert(not pcall(clearGameDetails, id))
assert(config[id].publisher[1] == "Publisher")
failWrites = false
assert(clearGameDetails(id))
assert(config[id].addedToLibraryDate == nil and config[id].publisher == nil and config[id].tags == nil)
assert(config[id].feed ~= nil)
assert(clearFeedSource(id) and config[id] == nil)
config[other].addedToLibrary = "2024-02-29"
assert(getGameDetails()[other] == nil) -- The old key is ignored, not converted.
assert(not pcall(setGameDetail, other, "addedToLibrary", "2024-02-29"))
assert(setGameDetail(other, "addedToLibraryDate", "2026-02-13"))
assert(getGameDetails()[other].addedToLibraryDate == "2026-02-13")
assert(config[other].addedToLibrary == "2024-02-29")
-- Feed bodies above the size limit never reach the UI thread.
local http = require("http")
local originalGet = http.get
config[id] = { feed = "https://example.com/feed" }
http.get = function() return { status = 200, body = string.rep("x", 5242881) } end
local tooLargeOk, tooLargeErr = pcall(fetchFeed, id)
assert(not tooLargeOk and tostring(tooLargeErr):find("too large", 1, true))
http.get = function() return { status = 200, body = "<rss/>" } end
assert(fetchFeed(id).xml == "<rss/>")
http.get = originalGet
config[id] = nil

-- Clearing without stored details is a no-op and never writes.
config[id] = { feed = "https://example.com/feed" }
failWrites = true
assert(clearGameDetails(id) and config[id].feed == "https://example.com/feed")
failWrites = false
config[id] = nil

-- Removed What's New articles expire with the What's New age limit; legacy URLs migrate.
local now = os.time()
config.feedRemovedItems = {
    "https://example.com/legacy",
    { url = "https://example.com/recent", removedAt = now - 60 },
    { url = "https://example.com/expired", removedAt = now - 2592001 },
    { url = 42 },
}
local removed = getFeedRemovedItems()
assert(#removed == 2 and removed[1] == "https://example.com/legacy" and removed[2] == "https://example.com/recent")
assert(#config.feedRemovedItems == 2 and type(config.feedRemovedItems[1].removedAt) == "number")
assert(addFeedRemovedItem("https://example.com/recent") and #config.feedRemovedItems == 2)
assert(addFeedRemovedItem("https://example.com/new") and #config.feedRemovedItems == 3)
assert(config.feedRemovedItems[3].url == "https://example.com/new")
assert(not pcall(addFeedRemovedItem, "javascript:alert(1)"))
config.feedRemovedItems = nil
assert(#getFeedRemovedItems() == 0 and config.feedRemovedItems == nil)

print("Backend regressions passed: ISO dates, game details, field preservation, deletion, write failures, "
    .. "feed size and removed items")
