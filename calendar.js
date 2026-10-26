/*
 * Marin STEM Navigator — calendar.js
 * ---------------------------------
 * This add-on ONLY adds Google/Apple calendar actions to existing program cards.
 * It does not change the website's search, filters, or other links.
 *
 * Optional calendar fields in data.js:
 *
 * 1) Event with known start/end times (offset REQUIRED):
 *    calendar: { kind: "event",
 *                start: "2027-05-02T10:00:00-07:00",
 *                end: "2027-05-02T16:00:00-07:00", label: "May 2..." }
 *
 * 2) Multi-day event with date but unknown hours (endDate is EXCLUSIVE):
 *    calendar: { kind: "event", startDate: "2027-09-24",
 *                endDate: "2027-09-27", label: "Sept 24-26..." }
 *
 * 3) Exact application deadline (offset REQUIRED):
 *    calendar: { kind: "deadline", due: "2026-12-06T23:59:00-05:00",
 *                label: "Dec 6, 11:59 PM Eastern" }
 *
 * 4) Deadline with only a confirmed date:
 *    calendar: { kind: "deadline", date: "2027-01-20" }
 *
 * Optional: location, notes, source, verifiedOn.
 * Missing/invalid calendar details => no calendar button.
 * All-day calendar END dates are exclusive (the day AFTER the last day).
 */

(function () {
    "use strict";

    // YYYY-MM-DD represents a date without a time zone.
    function validDay(value) {
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            return false;
        }
        const date = new Date(value + "T00:00:00Z");
        return !Number.isNaN(date.getTime()) &&
            date.toISOString().slice(0, 10) === value;
    }

    // A precise date/time must include a time zone, e.g. -07:00 or Z.
    function parseTimedDate(value) {
        if (typeof value !== "string" ||
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
            return null;
        }
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    // Convert a UTC Date into the format shared by Google and .ics files.
    function calendarUTC(date) {
        return date.toISOString()
            .replace(/[-:]/g, "")
            .replace(/\.\d{3}Z$/, "Z");
    }

    function compactDay(day) {
        return day.replace(/-/g, "");
    }

    function dayAfter(day) {
        const date = new Date(day + "T00:00:00Z");
        date.setUTCDate(date.getUTCDate() + 1);
        return date.toISOString().slice(0, 10);
    }

    // Today's date where an all-day event/deadline takes place.
    // Date-only entries have no time. Use Pacific time by default because
    // Marin STEM Navigator is based in California. A listing can optionally
    // supply calendar.timeZone, e.g. "America/New_York".
    function dayInTimeZone(now, timeZone) {
        try {
            const pieces = new Intl.DateTimeFormat("en-US", {
                timeZone: timeZone || "America/Los_Angeles",
                year: "numeric", month: "2-digit", day: "2-digit"
            }).formatToParts(now);
            const values = {};
            pieces.forEach(function (piece) {
                if (piece.type !== "literal") values[piece.type] = piece.value;
            });
            return values.year + "-" + values.month + "-" + values.day;
        } catch (error) {
            return null; // Invalid time zone: don't create an incorrect reminder.
        }
    }

    // Normalize one program's calendar information, or reject it safely.
    // Returning null means no Add to Calendar button should be displayed.
    function getCalendarInfo(program, now = new Date()) {
        if (!program || typeof program.name !== "string" ||
            !program.name.trim() || !program.calendar) {
            return null;
        }

        const event = program.calendar;
        const deadline = event.kind === "deadline";
        if (!deadline && event.kind !== "event") return null;

        let start;
        let end;
        let allDay = false;

        if (deadline && event.due) {
            // An exact deadline appears at its actual cutoff time, not midnight.
            const due = parseTimedDate(event.due);
            if (!due || due.getTime() <= now.getTime()) return null;
            start = calendarUTC(due);
            end = calendarUTC(new Date(due.getTime() + 60 * 1000));
        } else if (deadline && event.date) {
            const today = dayInTimeZone(now, event.timeZone);
            if (!validDay(event.date) || !today || event.date < today) return null;
            start = compactDay(event.date);
            end = compactDay(dayAfter(event.date));
            allDay = true;
        } else if (!deadline && event.start && event.end) {
            const first = parseTimedDate(event.start);
            const last = parseTimedDate(event.end);
            if (!first || !last || first >= last || last.getTime() <= now.getTime()) return null;
            start = calendarUTC(first);
            end = calendarUTC(last);
        } else if (!deadline && event.startDate && event.endDate) {
            const today = dayInTimeZone(now, event.timeZone);
            if (!validDay(event.startDate) || !validDay(event.endDate) ||
                !today || event.endDate <= event.startDate || event.endDate <= today) return null;
            start = compactDay(event.startDate);
            end = compactDay(event.endDate);
            allDay = true;
        } else {
            return null;
        }

        const title = (deadline ? "Deadline: " : "") + program.name;
        const officialLink = typeof event.source === "string" && event.source
            ? event.source : (program.url || "https://marinstemnavigator.org/");
        const details = [
            "Added from Marin STEM Navigator.",
            event.notes || "Review the program website before making plans.",
            "Official information: " + officialLink,
            event.verifiedOn ? "Date checked: " + event.verifiedOn : ""
        ].filter(Boolean).join("\n");

        return {
            title: title,
            start: start,
            end: end,
            allDay: allDay,
            location: typeof event.location === "string" ? event.location : "",
            label: typeof event.label === "string" ? event.label : "",
            details: details
        };
    }

    // Google Calendar: make a URL that opens a prefilled event for review.
    function googleCalendarURL(program) {
        const info = getCalendarInfo(program);
        if (!info) return null;

        const url = new URL("https://calendar.google.com/calendar/render");
        url.searchParams.set("action", "TEMPLATE");
        url.searchParams.set("text", info.title);
        url.searchParams.set("dates", info.start + "/" + info.end);
        url.searchParams.set("details", info.details);
        if (info.location) url.searchParams.set("location", info.location);
        return url.toString();
    }

    // Escape punctuation with special meaning in the iCalendar format.
    function escapeICSText(text) {
        return String(text)
            .replace(/\\/g, "\\\\")
            .replace(/\r\n|\n|\r/g, "\\n")
            .replace(/,/g, "\\,")
            .replace(/;/g, "\\;");
    }

    // iCalendar requires lines of no more than 75 UTF-8 bytes.
    function foldICSLine(line) {
        const encoder = new TextEncoder();
        let folded = "";
        let bytes = 0;
        for (const character of line) {
            const width = encoder.encode(character).length;
            if (bytes + width > 75) {
                folded += "\r\n ";
                bytes = 1; // continuation line begins with one space
            }
            folded += character;
            bytes += width;
        }
        return folded;
    }

    // Apple Calendar / Outlook: create the contents of an .ics file.
    function makeICS(program) {
        const info = getCalendarInfo(program);
        if (!info) return null;

        const slug = program.name.toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "").slice(0, 64) || "program";
        const uid = slug + "-" + info.start + "@marinstemnavigator.org";

        const lines = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//Marin STEM Navigator//Calendar Events//EN",
            "CALSCALE:GREGORIAN",
            "BEGIN:VEVENT",
            "UID:" + uid,
            "DTSTAMP:" + calendarUTC(new Date()),
            (info.allDay ? "DTSTART;VALUE=DATE:" : "DTSTART:") + info.start,
            (info.allDay ? "DTEND;VALUE=DATE:" : "DTEND:") + info.end,
            "SUMMARY:" + escapeICSText(info.title),
            "DESCRIPTION:" + escapeICSText(info.details)
        ];

        if (info.location) lines.push("LOCATION:" + escapeICSText(info.location));
        lines.push("END:VEVENT", "END:VCALENDAR");
        return lines.map(foldICSLine).join("\r\n") + "\r\n";
    }

    // Ask the browser to download the .ics file; no account connection needed.
    function downloadICS(program) {
        const content = makeICS(program);
        if (!content) return;

        const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
        const temporaryURL = URL.createObjectURL(blob);
        const downloadLink = document.createElement("a");
        downloadLink.href = temporaryURL;
        downloadLink.download = "stem-event.ics";
        document.body.appendChild(downloadLink);
        downloadLink.click();
        downloadLink.remove();
        setTimeout(function () {
            URL.revokeObjectURL(temporaryURL);
        }, 30000);
    }

    // Attach one accessible dropdown to each card that has a confirmed date.
    // The original render() already created the cards and supplies the same
    // filtered programs in the same order.
    function addButtons(visiblePrograms) {
        const cards = document.querySelectorAll("#output .card");
        visiblePrograms.forEach(function (program, index) {
            const info = getCalendarInfo(program);
            const card = cards[index];
            if (!info || !card) return;

            const menu = document.createElement("details");
            menu.className = "msn-calendar-menu";

            const heading = document.createElement("summary");
            heading.textContent = "+ Add to Calendar";
            menu.appendChild(heading);

            if (info.label) {
                const dateLabel = document.createElement("div");
                dateLabel.className = "msn-calendar-details";
                dateLabel.textContent = info.label;
                menu.appendChild(dateLabel);
            }

            const actions = document.createElement("div");
            actions.className = "msn-calendar-actions";

            const google = document.createElement("a");
            google.textContent = "Google Calendar ↗";
            google.dataset.calendarAction = "google"; // For distinct analytics event
            google.href = googleCalendarURL(program);
            google.target = "_blank";
            google.rel = "noopener noreferrer";
            actions.appendChild(google);

            const apple = document.createElement("button");
            apple.type = "button";
            apple.textContent = "Apple Calendar / Outlook (.ics) ↓";
            apple.dataset.calendarAction = "ics"; // Track clicks on .ics downloads
            apple.addEventListener("click", function () {
                downloadICS(program);
            });
            actions.appendChild(apple);

            const message = document.createElement("div");
            message.className = "msn-calendar-note";
            message.textContent = "Review the details before saving. A .ics file may need to be opened/imported.";
            actions.appendChild(message);
            menu.appendChild(actions);
            card.appendChild(menu);
        });
    }

    // A single global object gives index.html access to the new add-on.
    window.MSNCalendar = {
        addButtons: addButtons,
        googleCalendarURL: googleCalendarURL,
        makeICS: makeICS,
        getCalendarInfo: getCalendarInfo
    };
})();
