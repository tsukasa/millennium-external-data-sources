local millennium = require("millennium")
require("rpc_functions")

return {
    on_load = function()
        millennium.ready()
    end,

    on_unload = function()
        --- Unused ---
    end
}
