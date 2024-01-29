import ppg_table from "./ppg_table";
import guy_cheby from "./guy_cheby";
import ppg_choir from "./ppg_choir";
import guy_drone from "./guy_drone";

let WAVE_TABLES = {
    "PPG": ppg_table,
    "CHOIR": ppg_choir,
    "CHEBY": guy_cheby,
    "DRONE": guy_drone
};

export default WAVE_TABLES;