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
package.preload.json = function() return { encode = function(value) return value end } end
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
assert(getFeedSources()["570"] == nil and getReleaseDates()["570"] == nil)
assert(setShowFeedInWhatsNew(id, true))
assert(setMaxItemsFromFeedInWhatsNew(id, 5))
assert(config[id].feed == "https://example.com/feed" and config[id].releaseDate.day == 23)
assert(clearFeedSource(id))
assert(config[id].feed == nil and config[id].showFeedInWhatsNew == nil and config[id].maxItemsFromFeedInWhatsNew == nil)
assert(config[id].releaseDate.year == 2004 and config[id].custom == "keep")
assert(config[other].feed == "https://other.test/feed")

assert(setReleaseDate(id, 2024, 2, 29))
assert(config[id].releaseDate.day == 29 and config[id].custom == "keep")
assert(not pcall(setReleaseDate, id, 2025, 2, 29))
assert(setReleaseDate(id, 1960, 1, 1))
assert(setReleaseDate(id, os.date("*t").year + 1, 12, 31))
assert(not pcall(setReleaseDate, id, 1959, 12, 31))
assert(not pcall(setReleaseDate, id, os.date("*t").year + 2, 1, 1))
assert(setReleaseDate(id, 2024, 2, 29))
assert(config[id].releaseDate.year == 2024)
assert(saveFeedSource(id, "https://example.com/feed", true, 3))
assert(clearReleaseDate(id))
assert(config[id].releaseDate == nil and config[id].feed == "https://example.com/feed")
assert(clearFeedSource(id))
assert(config[id].custom == "keep")
config[id] = nil
assert(setReleaseDate(id, 2026, 10, 1))
assert(clearReleaseDate(id) and config[id] == nil)
assert(clearReleaseDate(id) and clearFeedSource(id))
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
assert(not pcall(setReleaseDate, "570", 2026, 10, 1))
assert(not pcall(setMaxItemsFromFeedInWhatsNew, id, 6))

assert(saveFeedSource(id, "https://example.com/feed", true, 3))
failWrites = true
assert(not pcall(setReleaseDate, id, 2026, 10, 1))
assert(not pcall(clearFeedSource, id))
assert(config[id].releaseDate == nil and config[id].feed == "https://example.com/feed")
failWrites = false
assert(clearFeedSource(id) and config[id] == nil)
print("Backend regressions passed: field preservation, deletion, validation and write failures")
