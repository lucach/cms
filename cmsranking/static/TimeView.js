/* Programming contest management system
 * Copyright © 2012 Luca Wehrstedt <luca.wehrstedt@gmail.com>
 * Copyright © 2016 Luca Chiodini <luca@chiodini.org>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

function format_time(time, full) {
    var h = Math.floor(time / 3600);
    var m = Math.floor((time % 3600) / 60);
    var s = Math.floor(time % 60);
    h = full && h < 10 ? "0" + h : "" + h;
    m = m < 10 ? "0" + m : "" + m;
    s = s < 10 ? "0" + s : "" + s;
    return (h + ":" + m + ":" + s);
};

var TimeView = new function () {
    var self = this;

    // possible values:
    // - 0: elapsed time
    // - 1: remaining time
    // - 2: current (clock) time
    self.status = 0;

    // Difference in milliseconds between local time and server time (not
    // considering timezone offsets).
    self.server_time_offset = 0;

    self.get_server_time = function() {
        // Return the seconds since January 1, 1970 00:00:00 UTC (server time)
        return ($.now() + self.server_time_offset) / 1000;
    };

    self.get_server_timezoned_time = function(server_utc_offset) {
        var local_utc_offset = new Date().getTimezoneOffset() * -60;
        return self.get_server_time() + server_utc_offset - local_utc_offset;
    };

    self.init = function () {
        // Trigger a server time sync immediately, then after 10 seconds and
        // then forever each minute.
        self.sync_server_time();
        window.setTimeout(function() {
            self.sync_server_time();
        }, 10000);
        window.setInterval(function() {
            self.sync_server_time();
        }, 60000);

        window.setInterval(function() {
            self.on_timer();
        }, 1000);
        self.on_timer();

        $("#TimeView_selector_elapsed").click(function () {
            self.status = 0;
            self.on_timer();
            $("#TimeView_selector").removeClass("open");
        });

        $("#TimeView_selector_remaining").click(function () {
            self.status = 1;
            self.on_timer();
            $("#TimeView_selector").removeClass("open");
        });

        $("#TimeView_selector_current").click(function () {
            self.status = 2;
            self.on_timer();
            $("#TimeView_selector").removeClass("open");
        });

        $("#TimeView_expand").click(function () {
            $("#TimeView_selector").toggleClass("open");
        });

        $("#TimeView_selector").click(function (event) {
            event.stopPropagation();
            return false;
        });

        $("body").on("click", function () {
            $("#TimeView_selector").removeClass("open");
        })
    };

    self.on_timer = function () {
        var server_time = self.get_server_time();
        var c = null;

        // contests are iterated sorted by begin time
        // and the first one that's still running is chosen
        for (var j in DataStore.contest_list) {
            var contest = DataStore.contest_list[j];
            if (server_time <= contest['end']) {
                c = contest;
                break;
            }
        }

        if (c == null) {
            $("#TimeView_name").text();
        } else {
            $("#TimeView_name").text(c["name"]);
        }

        var date = new Date(server_time * 1000);
        var today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        var time = server_time - today.getTime() / 1000;

        var full_time = false;

        if (c == null) {
            // no "next contest": always show the clock
            $("#TimeView").removeClass("elapsed remaining pre_cont cont");
            $("#TimeView").addClass("current post_cont");
            full_time = true;
        } else {
            if (server_time < c['begin']) {
                // the next contest has yet to start: show remaining or clock
                $("#TimeView").removeClass("cont post_cont");
                $("#TimeView").addClass("pre_cont");
                if (self.status == 2) {
                    $("#TimeView").removeClass("elapsed remaining");
                    $("#TimeView").addClass("current");
                    full_time = true;
                } else {
                    $("#TimeView").removeClass("elapsed current");
                    $("#TimeView").addClass("remaining");
                    time = server_time - c['begin'];
                }
            } else {
                // the next contest already started: all options available
                $("#TimeView").removeClass("pre_cont post_cont");
                $("#TimeView").addClass("cont");
                if (self.status == 2) {
                    $("#TimeView").removeClass("elapsed remaining");
                    $("#TimeView").addClass("current");
                    full_time = true;
                } else if (self.status == 1) {
                    $("#TimeView").removeClass("elapsed current");
                    $("#TimeView").addClass("remaining");
                    time = server_time - c['end'];
                } else {
                    $("#TimeView").removeClass("remaining current");
                    $("#TimeView").addClass("elapsed");
                    time = server_time - c['begin'];
                }
            }
        }

        // If we are showing the clock and we have information about a contest,
        // set the clock in the contest timezone. Adding the offset could
        // change the day, so it has to be redetermined.
        if (self.status == 2 && c != null) {
            var timezoned_time = self.get_timezoned_time(c["tz_offset"]);
            date = new Date(timezoned_time * 1000);
            today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
            time = timezoned_time - today.getTime() / 1000;
        }

        var time_str = format_time(Math.abs(Math.floor(time)), full_time);
        if (time < 0) {
            time_str = '-' + time_str;
        }

        $("#TimeView_time").text(time_str);
    };

    self.offsets = [];

    self.sync_server_time = function() {
        var start_time = $.now();
        $.ajax({
            url: Config.get_time_url(),
            success: function (data, status, xhr) {
                var end_time = $.now();
                var server_timestamp = parseInt(xhr.getResponseHeader("Timestamp"));
                var offset = (2 * server_timestamp - start_time - end_time) / 2;

                // Keep only the ten most recent.
                self.offsets.sort(function(off1, off2){return off1.idx - off2.idx});
                if (self.offsets.length >= 10)
                    self.offsets.shift();

                self.offsets.push({'offset': offset,
                    'rtt': end_time - start_time, 'idx': server_timestamp});

                // Sort by increasing RTT.
                self.offsets.sort(function(off1, off2){return off1.rtt - off2.rtt});

                // Compute average offset considering only the 5 values with
                // the lowest RTT.
                var sum_offset = 0, num = Math.min(5, self.offsets.length);
                for (var i = 0; i < num; i++)
                    sum_offset += self.offsets[i].offset;
                var avg_offset = sum_offset / num;

                // Adjust time with smoothing. If the difference between shown
                // and real time is greater than 10 seconds, update in one shot.
                // Otherwise, the (small) difference is gradually corrected
                // adding (or subtracting) 500 ms.
                var delta = avg_offset - self.server_time_offset;
                if (Math.abs(delta) >= 10000)
                    self.server_time_offset += delta;
                else
                    if (delta > 0)
                        self.server_time_offset += Math.min(delta, 500);
                    else
                        self.server_time_offset -= Math.min(-delta, 500);
            },
            error: function () {
                console.info("Network error occurred while synchronizing server time");
            }
        });
    };
};
