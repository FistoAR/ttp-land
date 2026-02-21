/* ═══════════════════════════════════════════════════════
   INTERACTIVE PLOT MAP — FULL FEATURED SCRIPT
   • Loads plot/customer/mediator data from API
   • When plot clicked: loads existing customer + mediators from DB
   • Edit mode for existing customers
   • Status lock: reserved→booked only, booked→registered only, registered=locked
   • Available option: visible only when customer exists, deletes customer on selection
   • SVG color/stamp updates ONLY after successful API save
═══════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /* ══ CONFIG ══════════════════════════════════════════ */
  var SVG_URL = "./plot_final_1.svg";
  var API_BASE = "/api";
  var STAMP_PREFIX = "stamp-plot-";

  /* ══ RUNTIME STATE ═══════════════════════════════════ */
  var plotDB = {};
  var customerStore = [];
  var knownMediators = [];

  /* ── Popup mode: 'new' | 'edit' ── */
  var popupMode = "new";
  var editCustomerId = null; // DB id of the customer being edited
  var existingStatus = null; // the status already in DB for this plot's customer

  var inlineSvg = null;
  var origVbX = 0,
    origVbY = 0,
    origVbW = 0,
    origVbH = 0;
  var vbX = 0,
    vbY = 0,
    vbW = 0,
    vbH = 0;
  var MIN_SCALE = 0.8,
    MAX_SCALE = 3,
    ZOOM_SPEED = 0.0015;

  var selectedPlot = null;
  var originalColor = "";
  var currentPlotId = null;
  var currentStatus = null;

  /* ══ DOM REFS ════════════════════════════════════════ */
  var viewport = document.getElementById("viewport");
  var svgContainer = document.getElementById("svg-container");
  var badge = document.getElementById("zoom-badge");
  var toast = document.getElementById("toast");
  var popup = document.getElementById("popup");
  var loading = document.getElementById("loading");
  var tooltip = document.getElementById("svg-tooltip");
  var instList = document.getElementById("instList");
  var instCount = 0;

  /* ══════════════════════════════════════════════════
       API HELPERS
    ══════════════════════════════════════════════════ */
  async function apiFetch(path, options) {
    options = options || {};
    options.credentials = "same-origin";
    if (options.body && typeof options.body === "object") {
      options.headers = Object.assign(
        { "Content-Type": "application/json" },
        options.headers || {},
      );
      options.body = JSON.stringify(options.body);
    }
    var res = await fetch(API_BASE + path, options);
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok)
      throw new Error(data.error || "Request failed (" + res.status + ")");
    return data;
  }

  /* ══════════════════════════════════════════════════
       BOOTSTRAP
    ══════════════════════════════════════════════════ */
  async function bootstrap() {
    try {
      var me = await apiFetch("/auth/me");
      if (me.loggedIn) {
        currentUser = me.user;
        isLoggedIn = true;
        setLoggedInUI();
      }
      var plots = await apiFetch("/plots");
      plotDB = plots;

      var meds = await apiFetch("/mediators");
      knownMediators = meds;
      buildMedDatalist();
      syncMedToCustomerDropdown();

      if (isLoggedIn) await loadCustomers();
    } catch (err) {
      console.error("Bootstrap error:", err);
    }
    loadSVG();
  }

  async function loadCustomers() {
    try {
      customerStore = await apiFetch("/customers");
    } catch (err) {
      console.warn("Could not load customers:", err.message);
      customerStore = [];
    }
  }

  /* ══════════════════════════════════════════════════
       TOOLTIP
    ══════════════════════════════════════════════════ */
  function posTT(mx, my) {
    var gap = 12,
      tw = tooltip.offsetWidth,
      th = tooltip.offsetHeight;
    var top = my - th - gap;
    if (top < 8) top = my + gap;
    var left = Math.max(8, Math.min(mx - tw / 2, window.innerWidth - tw - 8));
    tooltip.style.top = top + "px";
    tooltip.style.left = left + "px";
  }
  function showTT(html, mx, my) {
    tooltip.innerHTML = html;
    tooltip.style.display = "block";
    tooltip.offsetHeight;
    requestAnimationFrame(function () {
      tooltip.classList.add("visible");
    });
    posTT(mx, my);
  }
  function hideTT() {
    tooltip.classList.remove("visible");
    setTimeout(function () {
      if (!tooltip.classList.contains("visible"))
        tooltip.style.display = "none";
    }, 180);
  }

  /* ══════════════════════════════════════════════════
       HELPERS
    ══════════════════════════════════════════════════ */
  function isOpen() {
    return popup.classList.contains("show");
  }
  function getZoom() {
    return origVbW / vbW;
  }
  function clampZ(z) {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, z));
  }
  function today() {
    return new Date().toISOString().split("T")[0];
  }

  function applyVB() {
    if (!inlineSvg) return;
    inlineSvg.setAttribute("viewBox", vbX + " " + vbY + " " + vbW + " " + vbH);
    badge.textContent = Math.round(getZoom() * 100) + " %";
  }
  function s2svg(sx, sy) {
    var r = inlineSvg.getBoundingClientRect();
    return {
      x: vbX + ((sx - r.left) / r.width) * vbW,
      y: vbY + ((sy - r.top) / r.height) * vbH,
    };
  }
  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function escHtml(str) {
    return escapeHTML(str);
  }

  /* ══════════════════════════════════════════════════
       TOAST
    ══════════════════════════════════════════════════ */
  var _toastTimer;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.remove("hidden");
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () {
      toast.classList.add("hidden");
    }, 3500);
  }
  setTimeout(function () {
    toast.classList.add("hidden");
  }, 4000);

  /* ══════════════════════════════════════════════════
       TAB SWITCH
    ══════════════════════════════════════════════════ */
  window.switchTab = function (t) {
    ["plot", "customer", "mediator"].forEach(function (n) {
      document.getElementById("tab-" + n).classList.toggle("active", n === t);
      document.getElementById("panel-" + n).classList.toggle("active", n === t);
    });
  };
  window.switchDashTab = function (t) {
    ["customer", "mediator", "plot"].forEach(function (n) {
      document.getElementById("dtab-" + n).classList.toggle("active", n === t);
      document
        .getElementById("dpanel-" + n)
        .classList.toggle("active", n === t);
    });
  };

  /* ══════════════════════════════════════════════════
       STAMP HELPERS
    ══════════════════════════════════════════════════ */
  function getStampId(plotId) {
    var d = plotDB[plotId] || {};
    return STAMP_PREFIX + (d.stampNum || d.plotNum || "1");
  }
  function hideStampEl(el) {
    if (!el) return;
    el.style.display = "none";
    el.setAttribute("opacity", "0");
  }
  function showStampEl(el) {
    if (!el) return;
    el.style.display = "";
    el.style.visibility = "visible";
    el.setAttribute("opacity", "1");
    el.removeAttribute("display");
    el.querySelectorAll("*").forEach(function (c) {
      c.style.display = "";
      c.style.visibility = "visible";
      c.removeAttribute("display");
    });
  }
  function showStamp(plotId) {
    if (!inlineSvg || !plotId) return;
    hideStamp(plotId);
    var el = inlineSvg.getElementById(getStampId(plotId));
    if (el) {
      showStampEl(el);
      return;
    }
    var ref = selectedPlot || inlineSvg.getElementById(plotId);
    if (!ref) return;
    try {
      var bb = ref.getBBox();
      var t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.setAttribute("id", "__fstamp__" + plotId);
      t.setAttribute("x", bb.x + bb.width / 2);
      t.setAttribute("y", bb.y + bb.height / 2);
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("dominant-baseline", "middle");
      t.setAttribute("font-size", Math.min(bb.width, bb.height) * 0.26 + "px");
      t.setAttribute("font-weight", "900");
      t.setAttribute("fill", "#fff");
      t.setAttribute("opacity", "0.92");
      t.setAttribute("pointer-events", "none");
      t.setAttribute("font-family", "Segoe UI,Arial,sans-serif");
      t.setAttribute("letter-spacing", "2");
      t.textContent = "SOLD";
      inlineSvg.appendChild(t);
    } catch (e) {
      console.warn("showStamp fallback failed:", e);
    }
  }
  function hideStamp(plotId) {
    if (!inlineSvg) return;
    var d = plotDB[plotId] || {};
    var el = inlineSvg.getElementById(
      STAMP_PREFIX + (d.stampNum || d.plotNum || "?"),
    );
    if (el) hideStampEl(el);
    var fb = inlineSvg.getElementById("__fstamp__" + (plotId || ""));
    if (fb) fb.remove();
  }

  /* ══════════════════════════════════════════════════
       APPLY SVG COLORS FROM plotDB
    ══════════════════════════════════════════════════ */
  function applyInitialStatuses() {
    if (!inlineSvg) return;
    var allStamps = inlineSvg.querySelectorAll('[id^="' + STAMP_PREFIX + '"]');
    allStamps.forEach(function (el) {
      var ancestor = el.parentElement,
        isNested = false;
      while (ancestor && ancestor !== inlineSvg) {
        if (ancestor.id && ancestor.id.indexOf(STAMP_PREFIX) === 0) {
          isNested = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (!isNested) hideStampEl(el);
    });

    Object.keys(plotDB).forEach(function (plotId) {
      var d = plotDB[plotId];
      var stampEl = inlineSvg.getElementById(STAMP_PREFIX + d.stampNum);
      var plotEl = d.visibleId
        ? inlineSvg.getElementById(d.visibleId)
        : inlineSvg.getElementById(plotId) ||
          inlineSvg.getElementById("Plot-" + d.plotNum) ||
          inlineSvg.getElementById("plot-" + d.plotNum);
      if (!plotEl) {
        console.warn("Shape not found for", plotId);
        return;
      }
      var status = (d.status || "").toLowerCase();
      if (status === "booked-registered") {
        plotEl.setAttribute("fill", "#F48274");
        if (stampEl) showStampEl(stampEl);
        else showStamp(plotId);
      } else if (status === "booked") {
        plotEl.setAttribute("fill", "#F48274");
      } else if (status === "reserved") {
        plotEl.setAttribute("fill", "#FFD253");
      }
    });
  }

  function applyPlotStatusOnSVG(plotId, newStatus) {
    var d = plotDB[plotId] || {};
    var plotEl = inlineSvg
      ? inlineSvg.getElementById(plotId) ||
        inlineSvg.getElementById("Plot-" + d.plotNum) ||
        inlineSvg.getElementById("plot-" + d.plotNum)
      : null;
    if (!plotEl) return;
    if (newStatus === "booked") {
      plotEl.setAttribute("fill", "#F48274");
      hideStamp(plotId);
      if (d) d.status = "booked";
    } else if (newStatus === "reserved") {
      plotEl.setAttribute("fill", "#FFD253");
      hideStamp(plotId);
      if (d) d.status = "reserved";
    } else if (newStatus === "registered") {
      plotEl.setAttribute("fill", "#F48274");
      showStamp(plotId);
      if (d) d.status = "Registration Done";
    } else if (newStatus === "available") {
      plotEl.setAttribute("fill", "#2BBCA5");
      hideStamp(plotId);
      if (d) d.status = "Available";
    }
  }

  /* ══════════════════════════════════════════════════
       STATUS LOCK HELPERS
       Determines which radio buttons to disable/enable
       based on the current committed status in DB
    ══════════════════════════════════════════════════ */
  /*
      Rules:
        NEW PLOT (no customer):
          - Show: reserved, booked, registered
          - Hide: available
        
        EXISTING CUSTOMER:
          - Show: all 4 options including available
          - reserved    → can pick: booked, registered, available
          - booked      → can pick: registered, available ONLY
          - registered  → ALL disabled (locked)
          
        Selecting "available" → triggers customer deletion
    */
  function applyStatusLock(dbStatus) {
    var rdoBooked = document.getElementById("rdoBooked");
    var rdoReserved = document.getElementById("rdoReserved");
    var rdoRegistered = document.getElementById("rdoRegistered");
    var rdoAvailable = document.getElementById("rdoAvailable");

    var lblBooked = document.getElementById("sradio-booked");
    var lblReserved = document.getElementById("sradio-reserved");
    var lblRegistered = document.getElementById("sradio-registered");
    var lblAvailable = document.getElementById("sradio-available");

    // Reset all first
    [rdoBooked, rdoReserved, rdoRegistered, rdoAvailable].forEach(function (r) {
      if (r) r.disabled = false;
    });
    [lblBooked, lblReserved, lblRegistered, lblAvailable].forEach(function (l) {
      if (l) {
        l.classList.remove("sradio-locked");
        l.title = "";
      }
    });

    if (!dbStatus || dbStatus === "available") {
      // Fresh plot — hide Available option, show only booking options
      if (lblAvailable) lblAvailable.style.display = "none";
      return;
    }

    // Plot has a customer — show Available option
    if (lblAvailable) lblAvailable.style.display = "flex";

    if (dbStatus === "reserved") {
      // Reserved already selected; cannot go BACK to reserved (it stays)
      // Can pick: booked, registered, or available (to delete customer)
      rdoReserved.disabled = true;
      lblReserved.classList.add("sradio-locked");
      lblReserved.title = "Already Reserved";
      return;
    }

    if (dbStatus === "booked") {
      // Can only go to registered or available (to delete)
      rdoBooked.disabled = true;
      rdoReserved.disabled = true;
      lblBooked.classList.add("sradio-locked");
      lblReserved.classList.add("sradio-locked");
      lblBooked.title = "Already Booked — cannot go back";
      lblReserved.title = "Cannot downgrade from Booked";
      return;
    }

    if (dbStatus === "registered") {
      // Fully locked — cannot change to anything
      rdoBooked.disabled = true;
      rdoReserved.disabled = true;
      rdoRegistered.disabled = true;
      rdoAvailable.disabled = true;
      [lblBooked, lblReserved, lblRegistered, lblAvailable].forEach(
        function (l) {
          l.classList.add("sradio-locked");
          l.title = "🔒 Registered — status is locked";
        },
      );
      return;
    }
  }

  /* Set the radio to current status and mark it selected */
  function setRadioToStatus(dbStatus) {
    var rdoBooked = document.getElementById("rdoBooked");
    var rdoReserved = document.getElementById("rdoReserved");
    var rdoRegistered = document.getElementById("rdoRegistered");
    var rdoAvailable = document.getElementById("rdoAvailable");

    rdoBooked.checked = false;
    rdoReserved.checked = false;
    rdoRegistered.checked = false;
    if (rdoAvailable) rdoAvailable.checked = false;

    clearRadioStyles();

    if (dbStatus === "booked") {
      rdoBooked.checked = true;
      document.getElementById("sradio-booked").classList.add("is-booked");
    } else if (dbStatus === "reserved") {
      rdoReserved.checked = true;
      document.getElementById("sradio-reserved").classList.add("is-reserved");
    } else if (dbStatus === "registered") {
      rdoRegistered.checked = true;
      document
        .getElementById("sradio-registered")
        .classList.add("is-registered");
    }
  }

  // ******************admin page Plot Image Functionality****************

  function loadAdminPlotImage(plotId) {
    var d = plotDB[plotId] || {};
    var plotNum = d.plotNum || (plotId.match(/\d+/) || [""])[0];
    var imgEl = document.getElementById("adminPlotImg");
    var errEl = document.getElementById("adminPlotImgErr");

    if (!plotNum) {
      imgEl.style.display = "none";
      errEl.style.display = "flex";
      return;
    }

    /* Reset state */
    imgEl.style.display = "block";
    errEl.style.display = "none";
    imgEl.src = "";

    /* Use same image path convention as customer popup */
    imgEl.src = "src/Plot-img-" + plotNum + ".png";
  }

  // ✅ Checkbox — registered ONCE outside openPopup
  document
    .getElementById("chkPlotPrice")
    .addEventListener("change", function () {
      var bp = document.getElementById("bookingPrice");
      if (this.checked) {
        var d = plotDB[currentPlotId];
        if (d && d.price) {
          bp.value = Number(d.price); // exact DB price
          bp.readOnly = true;
          bp.style.background = "#f0f0f0";
        }
      } else {
        bp.readOnly = false;
        bp.style.background = "";
        bp.value = "";
      }
    });

  /* ══════════════════════════════════════════════════
       OPEN POPUP
       Fetches existing customer data if plot is not available
    ══════════════════════════════════════════════════ */
  async function openPopup(plotId) {
    currentPlotId = plotId;
    currentStatus = null;
    popupMode = "new";
    editCustomerId = null;
    existingStatus = null;

    var d = plotDB[plotId] || {};

    /* Header */
    document.getElementById("phTitle").textContent =
      (d.title || plotId) + " Details";
    document.getElementById("phBadge").textContent = d.title || plotId;

    /* Plot tab */
    document.getElementById("plotNumber").value = d.title || plotId;
    // Show price with Indian comma formatting when popup opens
    document.getElementById("plotPrice").value = d.price
      ? Number(d.price).toLocaleString("en-IN")
      : "";
    // document.getElementById('plotLength').value = d.length || '';
    // document.getElementById('plotWidth').value = d.width || '';
    document.getElementById("plotSqft").value = d.sqft || "";
    document.getElementById("plotCent").value = d.cent || "";
    document.getElementById("plotFacing").value = d.facing || "";
    /* Load plot image in admin view */
    loadAdminPlotImage(plotId);
    // document.getElementById('priceBadgeAmt').textContent = d.price ? '₹' + (Number(d?.price).toLocaleString('en-IN') * Number(d?.cent).toLocaleString('en-IN')).toFixed(2) : '';
    // ✅ CORRECT — show exact price from DB
    document.getElementById("priceBadgeAmt").textContent = d.price
      ? "₹" + Number(d.price).toLocaleString("en-IN")
      : "";
    /* Reset customer tab */
    document.getElementById("custName").value = "";
    document.getElementById("custPhone").value = "";
    document.getElementById("mediatorSel").value = "";
    document.getElementById("mediatorOther").value = "";
    document.getElementById("mediatorOther").style.display = "none";
    document.getElementById("closureDate").value = "";
    document.getElementById("custMedAmount").value = "";
    var bp = document.getElementById("bookingPrice");
    bp.value = "";
    bp.readOnly = false;
    bp.style.background = "";
    document.getElementById("chkPlotPrice").checked = false;

    /* Reset status radios */
    clearRadioStyles();
    applyStatusLock(null); // enable all

    resetInst();
    resetMedTab();

    /* ── Load existing mediators for this plot ── */
    loadMediatorsForPlot(plotId);

    /* ── If plot already has a customer — load & populate edit mode ── */
    var plotStatus = (d.status || "").toLowerCase();
    if (plotStatus && plotStatus !== "available") {
      try {
        var custData = await apiFetch(
          "/customers/by-plot/" + encodeURIComponent(plotId),
        );
        if (custData) {
          popupMode = "edit";
          editCustomerId = custData.id;
          existingStatus = custData.status; // 'booked' | 'reserved' | 'registered'

          /* Fill fields */
          document.getElementById("custName").value =
            custData.customerName || "";
          document.getElementById("custPhone").value =
            custData.customerPhone || "";
          document.getElementById("closureDate").value =
            custData.closureDate || "";
          document.getElementById("bookingPrice").value =
            custData.bookingAmount || "";
          document.getElementById("custMedAmount").value =
            custData.commission || "";

          /* Mediator */
          document.getElementById("mediatorSel").value =
            custData.mediator || "";

          /* Installments */
          instList.innerHTML = "";
          instCount = 0;
          if (custData.installments && custData.installments.length > 0) {
            custData.installments.forEach(function (inst) {
              instCount++;
              var row = document.createElement("div");
              row.className = "irow";
              row.innerHTML =
                '<div class="itop"><span class="ino">Entry #' +
                instCount +
                "</span>" +
                '<button class="btnrm" title="Remove">✕</button></div>' +
                '<div class="ifields">' +
                '<div class="fg"><label>Amount Received (₹)</label><input type="text" class="ia" placeholder="₹" value="' +
                inst.amount+
                '"></div>' +
                '<div class="fg"><label>Date Received</label><input type="date" class="id" value="' +
                escapeHTML(inst.date || "") +
                '"></div>' +
                '<div class="fg"><label>Next Follow-up Date</label><input type="date" class="if" value="' +
                escapeHTML(inst.followUp || "") +
                '"></div>' +
                "</div>";
              row
                .querySelector(".btnrm")
                .addEventListener("click", function () {
                  row.remove();
                  instList.querySelectorAll(".ino").forEach(function (el, i) {
                    el.textContent = "Entry #" + (i + 1);
                  });
                  instCount = instList.querySelectorAll(".irow").length;
                });
              instList.appendChild(row);
            });
          }
 
          else {
            addInstRow();
          }

          /* Status radio + lock */
          setRadioToStatus(custData.status);
          applyStatusLock(custData.status);
          currentStatus = custData.status;

          /* Update save button label */
          document.getElementById("btnSaveCust").textContent =
            "💾 Update Customer Details";

          /* Show edit banner */
          showEditBanner(custData.status);
        }
      } catch (err) {
        console.warn("Could not load customer for plot:", err.message);
      }
    } else {
      document.getElementById("btnSaveCust").textContent =
        "💾 Save Customer Details";
      hideEditBanner();
      applyStatusLock(null);
      addInstRow();
    }

    syncMedToCustomerDropdown();
    switchTab("plot");
    popup.classList.add("show");
  }

  /* ── Edit mode banner inside customer tab ── */
  function showEditBanner(status) {
    var existing = document.getElementById("edit-mode-banner");
    if (existing) existing.remove();
    var locked = status === "registered";
    var banner = document.createElement("div");
    banner.id = "edit-mode-banner";
    banner.style.cssText =
      "background:" +
      (locked ? "#fdecea" : "#e8f4fd") +
      ";border:1px solid " +
      (locked ? "#f5c6cb" : "#bee5eb") +
      ";border-radius:8px;padding:9px 14px;margin-bottom:12px;font-size:13px;color:" +
      (locked ? "#721c24" : "#0c5460") +
      ";display:flex;align-items:center;gap:8px;";
    banner.innerHTML = locked
      ? "<span>🔒</span><span><strong>Registered — Locked.</strong> This plot's status cannot be changed.</span>"
      : "<span>✏️</span><span><strong>Edit Mode</strong> — Updating existing customer record.</span>";
    var custPanel = document.getElementById("panel-customer");
    custPanel.insertBefore(banner, custPanel.firstChild);

    /* If registered — disable all customer fields too */
    if (locked) {
      [
        "custName",
        "custPhone",
        "mediatorSel",
        "mediatorOther",
        "bookingPrice",
        "custMedAmount",
        "closureDate",
        "btnAddInst",
      ].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.disabled = true;
      });
      document.getElementById("btnSaveCust").disabled = true;
      document.getElementById("btnSaveCust").textContent =
        "🔒 Registered — Cannot Edit";
    } else {
      [
        "custName",
        "custPhone",
        "mediatorSel",
        "mediatorOther",
        "bookingPrice",
        "custMedAmount",
        "closureDate",
        "btnAddInst",
      ].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.disabled = false;
      });
      document.getElementById("btnSaveCust").disabled = false;
    }
  }
  function hideEditBanner() {
    var existing = document.getElementById("edit-mode-banner");
    if (existing) existing.remove();
    [
      "custName",
      "custPhone",
      "mediatorSel",
      "mediatorOther",
      "bookingPrice",
      "custMedAmount",
      "closureDate",
      "btnAddInst",
    ].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.disabled = false;
    });
    document.getElementById("btnSaveCust").disabled = false;
  }

  /* ══════════════════════════════════════════════════
       LOAD MEDIATORS FOR PLOT  (from knownMediators + any plot-specific ones)
    ══════════════════════════════════════════════════ */
  function loadMediatorsForPlot(plotId) {
    /* mediatorRecords[plotId] already has any plot-specific additions this session.
           On fresh open, we show the global knownMediators list in the table
           so the user can see who's available and delete from global if needed. */
    /* Only populate from knownMediators if not already populated this session */
    if (!mediatorRecords[plotId]) {
      mediatorRecords[plotId] = [];
    }
    renderMedTable();
  }

  /* ══════════════════════════════════════════════════
       CLOSE POPUP
    ══════════════════════════════════════════════════ */
  function closePopup() {
    popup.classList.remove("show");
    /* Restore SVG color only if nothing was saved */
    if (selectedPlot && originalColor !== "" && !currentStatus) {
      selectedPlot.setAttribute("fill", originalColor);
      hideStamp(currentPlotId);
    }
    hideEditBanner();
    selectedPlot = null;
    originalColor = "";
    currentPlotId = null;
    currentStatus = null;
    popupMode = "new";
    editCustomerId = null;
    existingStatus = null;
  }
  document.getElementById("adminPlotImg").src = "";
  document.getElementById("adminPlotImgErr").style.display = "none";
  document.getElementById("adminPlotImg").style.display = "block";
  document.getElementById("btnClose").addEventListener("click", closePopup);
  popup.addEventListener("click", function (e) {
    if (e.target === popup) closePopup();
  });
  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen()) closePopup();
  });

  /* ══════════════════════════════════════════════════
       SAVE — PLOT TAB
    ══════════════════════════════════════════════════ */
  document
    .getElementById("btnSavePlot")
    .addEventListener("click", async function () {
      if (!currentPlotId) return;
      var d = plotDB[currentPlotId];
      if (!d) return;
      var payload = {
        price:
          parseFloat(
            document.getElementById("plotPrice").value.replace(/,/g, ""),
          ) || d.price,
        length: null,
        width: null,
        sqft: parseFloat(document.getElementById("plotSqft").value) || d.sqft,
        cent: parseFloat(document.getElementById("plotCent").value) || d.sqft,
        facing: document.getElementById("plotFacing").value || d.facing,
      };
      try {
        await apiFetch("/plots/" + currentPlotId, {
          method: "PUT",
          body: payload,
        });
        Object.assign(d, payload);
        closePopup();
        showToast("✅ Plot details saved for " + d.title);
      } catch (err) {
        showToast("❌ " + err.message);
      }
    });

  function calcSqft() {
    var l = parseFloat(document.getElementById("plotLength").value) || 0;
    var w = parseFloat(document.getElementById("plotWidth").value) || 0;
    if (l && w) document.getElementById("plotSqft").value = l * w;
  }
  // document.getElementById('plotLength').addEventListener('input', calcSqft);
  // document.getElementById('plotWidth').addEventListener('input', calcSqft);

  /* ══════════════════════════════════════════════════
       STATUS RADIO BUTTONS
    ══════════════════════════════════════════════════ */
  var rdoBooked = document.getElementById("rdoBooked");
  var rdoReserved = document.getElementById("rdoReserved");
  var rdoRegistered = document.getElementById("rdoRegistered");
  var rdoAvailable = document.getElementById("rdoAvailable");

  var radioLabels = {
    booked: document.getElementById("sradio-booked"),
    reserved: document.getElementById("sradio-reserved"),
    registered: document.getElementById("sradio-registered"),
    available: document.getElementById("sradio-available"),
  };

  function clearRadioStyles() {
    Object.values(radioLabels).forEach(function (l) {
      if (l)
        l.classList.remove(
          "is-booked",
          "is-reserved",
          "is-registered",
          "is-available",
        );
    });
  }

  function handleStatusRadio(value) {
    /* If radio is disabled, do nothing */
    if (
      (value === "booked" && rdoBooked.disabled) ||
      (value === "reserved" && rdoReserved.disabled) ||
      (value === "registered" && rdoRegistered.disabled) ||
      (value === "available" && rdoAvailable && rdoAvailable.disabled)
    )
      return;

    clearRadioStyles();
    currentStatus = value;

    if (value === "booked") {
      radioLabels.booked.classList.add("is-booked");
      if (selectedPlot) selectedPlot.setAttribute("fill", "#F48274");
      hideStamp(currentPlotId);
    } else if (value === "reserved") {
      radioLabels.reserved.classList.add("is-reserved");
      if (selectedPlot) selectedPlot.setAttribute("fill", "#FFD253");
      hideStamp(currentPlotId);
    } else if (value === "registered") {
      radioLabels.registered.classList.add("is-registered");
      if (selectedPlot) selectedPlot.setAttribute("fill", "#F48274");
      hideStamp(currentPlotId); // stamp shown only after confirmed save
    } else if (value === "available") {
      if (radioLabels.available)
        radioLabels.available.classList.add("is-available");
      if (selectedPlot) selectedPlot.setAttribute("fill", "#2BBCA5");
      hideStamp(currentPlotId);
    }
  }

  rdoBooked.addEventListener("change", function () {
    if (this.checked) handleStatusRadio("booked");
  });
  rdoReserved.addEventListener("change", function () {
    if (this.checked) handleStatusRadio("reserved");
  });
  rdoRegistered.addEventListener("change", function () {
    if (this.checked) handleStatusRadio("registered");
  });
  if (rdoAvailable) {
    rdoAvailable.addEventListener("change", function () {
      if (this.checked) handleStatusRadio("available");
    });
  }

  /* ══════════════════════════════════════════════════
       INSTALLMENT ROWS
    ══════════════════════════════════════════════════ */
  function addInstRow() {
    instCount++;
    var n = instCount,
      row = document.createElement("div");
    row.className = "irow";
    row.innerHTML =
      '<div class="itop"><span class="ino">Entry #' +
      n +
      "</span>" +
      '<button class="btnrm" title="Remove">✕</button></div>' +
      '<div class="ifields">' +
      '<div class="fg"><label>Amount Received (₹)</label><input type="text" class="ia" placeholder="₹" ></div>' +
      '<div class="fg"><label>Date Received</label><input type="date" class="id" value="' +
      today() +
      '"></div>' +
      '<div class="fg"><label>Next Follow-up Date</label><input type="date" class="if"></div>' +
      "</div>";
    row.querySelector(".btnrm").addEventListener("click", function () {
      row.remove();
      instList.querySelectorAll(".ino").forEach(function (el, i) {
        el.textContent = "Entry #" + (i + 1);
      });
      instCount = instList.querySelectorAll(".irow").length;
    });
    instList.appendChild(row);
    enforceIndianPrice(row.querySelector(".ia"));
  }

  function resetInst() {
    instList.innerHTML = "";
    instCount = 0;
  }
  document.getElementById("btnAddInst").addEventListener("click", addInstRow);

  /* ══════════════════════════════════════════════════
       SAVE — CUSTOMER TAB  (handles both NEW and EDIT, plus DELETE via Available)
    ══════════════════════════════════════════════════ */
  document
    .getElementById("btnSaveCust")
    .addEventListener("click", async function () {
      var selectedStatus = "";
      if (rdoBooked.checked) selectedStatus = "booked";
      if (rdoReserved.checked) selectedStatus = "reserved";
      if (rdoRegistered.checked) selectedStatus = "registered";
      if (rdoAvailable && rdoAvailable.checked) selectedStatus = "available";

      /* ═══ HANDLE "AVAILABLE" = DELETE CUSTOMER ═══ */
      if (selectedStatus === "available") {
        if (!editCustomerId) {
          showToast("⚠️ No customer to delete");
          return;
        }

        if (
          !confirm(
            "⚠️ Setting this plot to Available will DELETE the customer record.\n\nAre you sure?",
          )
        ) {
          return;
        }

        var btn = document.getElementById("btnSaveCust");
        btn.disabled = true;
        btn.textContent = "⏳ Deleting customer...";

        try {
          await apiFetch("/customers/" + editCustomerId, { method: "DELETE" });

          var savedPlotId = currentPlotId;
          currentStatus = null;
          selectedPlot = null;
          currentPlotId = null;
          originalColor = "";
          popup.classList.remove("show");
          hideEditBanner();

          applyPlotStatusOnSVG(savedPlotId, "available");
          await loadCustomers();
          showToast("✅ Customer deleted — Plot is now Available");
          loadDashboardStats();
        } catch (err) {
          showToast("❌ Failed to delete customer: " + err.message);
        } finally {
          btn.disabled = false;
          btn.textContent = "💾 Update Customer Details";
        }
        return;
      }

      /* ═══ NORMAL SAVE/UPDATE FLOW ═══ */
      var custName = document.getElementById("custName").value.trim();
      var custPhone = document.getElementById("custPhone").value.trim();
      var bookingAmt = document.getElementById("bookingPrice").value.trim();
      var closureDate = document.getElementById("closureDate").value;
      var commission = document.getElementById("custMedAmount").value.trim();
      var mediatorSel = document.getElementById("mediatorSel").value;
      var mediatorOther = document.getElementById("mediatorOther").value.trim();
      var mediator = mediatorSel === "other" ? mediatorOther : mediatorSel;

      var installments = [];
      document.querySelectorAll("#instList .irow").forEach(function (row) {
        var amt = row.querySelector(".ia"),
          date = row.querySelector(".id"),
          fu = row.querySelector(".if");
        if (amt && amt.value)
          installments.push({
            amount: amt.value,
            date: date ? date.value : "",
            followUp: fu ? fu.value : "",
          });
      });

      if (!custName) {
        document.getElementById("custName").focus();
        showToast("⚠️ Please enter customer name");
        return;
      }
      if (!selectedStatus) {
        showToast("⚠️ Please select a plot status");
        return;
      }
      if (custPhone && custPhone.length !== 10) {
        document.getElementById("custPhone").focus();
        showToast("⚠️ Phone must be 10 digits");
        return;
      }

      var btn = document.getElementById("btnSaveCust");
      btn.disabled = true;
      btn.textContent = "⏳ Saving…";

      try {
        var payload = {
          customerName: custName,
          customerPhone: custPhone,
          mediator: mediator,
          commission: commission,
          bookingAmount: bookingAmt,
          closureDate: closureDate,
          status: selectedStatus,
          installments: installments,
        };

        var result;
        if (popupMode === "edit" && editCustomerId) {
          /* ── EDIT ── */
          result = await apiFetch("/customers/" + editCustomerId, {
            method: "PUT",
            body: payload,
          });
        } else {
          /* ── NEW ── */
          payload.plotKey = currentPlotId;
          result = await apiFetch("/customers", {
            method: "POST",
            body: payload,
          });
        }

        /* ── Only update SVG AFTER confirmed save ── */
        var savedPlotId = currentPlotId;
        var savedStatus = selectedStatus;

        currentStatus = null;
        selectedPlot = null;
        currentPlotId = null;
        originalColor = "";
        popup.classList.remove("show");
        hideEditBanner();

        applyPlotStatusOnSVG(savedPlotId, savedStatus);

        await loadCustomers();
        showToast(
          "✅ Customer " +
            (popupMode === "edit" ? "updated" : "saved") +
            " — " +
            savedStatus.charAt(0).toUpperCase() +
            savedStatus.slice(1),
        );
        loadDashboardStats();
      } catch (err) {
        /* Show the lock error clearly */
        showToast("❌ " + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent =
          popupMode === "edit"
            ? "💾 Update Customer Details"
            : "💾 Save Customer Details";
      }
    });

  /* ══════════════════════════════════════════════════
       DASHBOARD
    ══════════════════════════════════════════════════ */
  var dashPopup = document.getElementById("dashboard-popup");
  var dashClose = document.getElementById("dash-close");
  var btnDashboard = document.getElementById("btn-dashboard");

  async function openDashboard() {
    dashPopup.classList.add("show");

    try {
      var freshPlots = await apiFetch("/plots");
      plotDB = freshPlots;
      updateStats(freshPlots);
    } catch (err) {
      console.error("Failed to reload plots:", err);
    }

    if (isLoggedIn) await loadCustomers();

    // ✅ Render directly — do NOT go through filterDashTable on open
    renderCustomerRows(customerStore);
    renderMediatorRows(knownMediators);
    renderPlotRows(Object.values(plotDB));
  }

  function closeDashboard() {
    dashPopup.classList.remove("show");
  }

  btnDashboard.addEventListener("click", openDashboard);
  dashClose.addEventListener("click", closeDashboard);
  dashPopup.addEventListener("click", function (e) {
    if (e.target === dashPopup) closeDashboard();
  });
  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && dashPopup.classList.contains("show"))
      closeDashboard();
  });

  function renderCustomerTable() {
    filterDashTable("customer");
  }

  function renderCustomerRows(data) {
    var tbody = document.getElementById("customerTableBody");
    if (data.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="10" style="text-align:center;color:#aaa;padding:28px 0;font-size:13px;">No customers found.</td></tr>';
      return;
    }
    tbody.innerHTML = "";
    data.forEach(function (c, i) {
      var statusHTML = "";
      if (c.status === "registered" || c.status === "register")
        statusHTML = '<span class="tstatus active">🏛 Registration done</span>';
      else if (c.status === "booked" || c.status === "progress")
        statusHTML = '<span class="tstatus inactive">🔖 Booked</span>';
      else if (c.status === "reserved")
        statusHTML =
          '<span class="tstatus" style="background:#fff3cd;color:#856404;">🔖 Reserved</span>';
      else
        statusHTML =
          '<span class="tstatus" style="background:#f0f0f0;color:#888;">—</span>';

      var bookingDisplay = c.bookingAmount
        ? "₹" + c.bookingAmount
        : "—";
      var closureDisplay = "—";
      if (c.closureDate) {
        var d = new Date(c.closureDate + "T00:00:00");
        closureDisplay = d.toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });
      }

      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" +
        (i + 1) +
        "</td>" +
        "<td>" +
        escapeHTML(c.customerName || "—") +
        "</td>" +
        "<td>" +
        escapeHTML(c.customerPhone || "—") +
        "</td>" +
        "<td><strong>" +
        escapeHTML(c.plotLabel || "—") +
        "</strong></td>" +
        "<td>" +
        bookingDisplay +
        "</td>" +
        "<td>" +
        escapeHTML(c.mediator || "—") +
        "</td>" +
        "<td>₹" +
        escapeHTML(String(c.commission || "0")) +
        "</td>" +
        "<td>" +
        closureDisplay +
        "</td>" +
        "<td>" +
        statusHTML +
        "</td>" +
        '<td><button class="dtab-view-btn" data-idx="' +
        customerStore.indexOf(c) +
        '">👁 View</button></td>';
      tr.querySelector(".dtab-view-btn").addEventListener("click", function () {
        openInstModal(parseInt(this.getAttribute("data-idx")));
      });
      tbody.appendChild(tr);
    });
  }

  var _currentInstIdx = null;

function openInstModal(idx) {
    var c = customerStore[idx];
    if (!c) return;
    _currentInstIdx = idx;
 
    document.getElementById("inst-modal-customer").textContent =
      (c.customerName || "—") + " · " + (c.plotLabel || "—");
    var plot =
      Object.values(plotDB).find(function (p) {
        return p.title === c.plotLabel;
      }) || null;
    var statusLabel =
      c.status === "registered" || c.status === "register"
        ? "✅ Booked with Registered"
        : c.status === "booked" || c.status === "progress"
          ? "🔖 Booked"
          : c.status === "reserved"
            ? "🔖 Reserved"
            : "—";
    var closureDisplay = "—";
    if (c.closureDate) {
      var cd = new Date(c.closureDate + "T00:00:00");
      closureDisplay = cd.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    }
 
    function field(label, value) {
      return (
        '<div class="imd-fg"><label>' +
        label +
        '</label><div class="imd-field-val">' +
        escapeHTML(String(value || "—")) +
        "</div></div>"
      );
    }
    var html = "";
    html += '<div class="imd-slabel">Customer Information</div>';
    html +=
      '<div class="imd-r2 imd-mb">' +
      field("Customer Name", c.customerName) +
      field("Phone Number", c.customerPhone) +
      "</div>";
    html +=
      '<div class="imd-r2 imd-mb">' +
      field("Mediator Name", c.mediator) +
      field(
        "Commission (₹)",
        c.commission ? "₹" + c.commission : "—",
      ) +
      "</div>";
    html += '<hr class="imd-div">';
    html += '<div class="imd-slabel">Plot Details</div>';
    html +=
      '<div class="imd-r2 imd-mb">' +
      field("Plot", c.plotLabel) +
      field("Facing", plot ? plot.facing || "—" : "—") +
      "</div>";
    html +=
      '<div class="imd-r3 imd-mb">' +
      field(
        "Dimensions",
        plot ? (plot.length || "—") + " × " + (plot.width || "—") + " ft" : "—",
      ) +
      field(
        "Area (sq.ft)",
        plot && plot.sqft
          ? Number(plot.sqft).toLocaleString("en-IN") + " sq.ft"
          : "—",
      ) +
      field(
        "Plot Price (₹)",
        c.bookingAmount
          ? "₹" + c.bookingAmount
          : "—",
      ) +
      "</div>";
    html += '<hr class="imd-div">';
    html += '<div class="imd-slabel">Status & Closure</div>';
    html +=
      '<div class="imd-r2 imd-mb">' +
      field("Expected Closure Date", closureDisplay) +
      field("Booking Status", statusLabel) +
      "</div>";
    html += '<hr class="imd-div">';
    document.getElementById("inst-modal-info").innerHTML = html;
 
    var tbody = document.getElementById("inst-modal-tbody");
    tbody.innerHTML = "";
    var total = 0;
    if (!c.installments || c.installments.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="4" style="text-align:center;color:#aaa;padding:20px;">No installments recorded.</td></tr>';
    } else {
      c.installments.forEach(function (inst, i) {
        var amt = parseFloat(String(inst.amount).replace(/,/g, "")) || 0;
        total += amt;
        console.log(`Total: ${total}`);
        var tr = document.createElement("tr");
        tr.innerHTML =
          "<td>" +
          (i + 1) +
          "</td><td>₹" +
          amt.toLocaleString("en-IN") +
          "</td><td>" +
          (inst.date || "—") +
          "</td><td>" +
          (inst.followUp || "—") +
          "</td>";
        tbody.appendChild(tr);
      });
    }
    document.getElementById("inst-modal-total").innerHTML =
      "<strong>Total Paid: ₹" + total + "</strong>";
    document.getElementById("inst-modal").classList.add("show");
  }
 

  document
    .getElementById("inst-modal-close")
    .addEventListener("click", function () {
      document.getElementById("inst-modal").classList.remove("show");
    });
  document
    .getElementById("inst-export-btn")
    .addEventListener("click", function () {
      if (_currentInstIdx !== null) {
        exportCustomerToExcel(_currentInstIdx);
      }
    });
  document.getElementById("inst-modal").addEventListener("click", function (e) {
    if (e.target === this) this.classList.remove("show");
  });
  /* ══ EXPORT SINGLE CUSTOMER TO EXCEL ══ */
  function exportCustomerToExcel(idx) {
    var c = customerStore[idx];
    if (!c) return;

    var plot =
      Object.values(plotDB).find(function (p) {
        return p.title === c.plotLabel;
      }) || null;

    var statusLabel =
      c.status === "registered" || c.status === "register"
        ? "Registration Done"
        : c.status === "booked" || c.status === "progress"
          ? "Booked"
          : c.status === "reserved"
            ? "Reserved"
            : c.status || "—";

    var closureDisplay = "—";
    if (c.closureDate) {
      var cd = new Date(c.closureDate + "T00:00:00");
      closureDisplay = cd.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    }

    var hasInstallments = c.installments && c.installments.length > 0;

    /* ── Build rows ── */
    var rows = [];

    /* Section 1: Customer Info Header */
    rows.push(["CUSTOMER DETAILS"]);
    rows.push([]);

    rows.push(["Customer Name", c.customerName || "—"]);
    rows.push(["Phone Number", c.customerPhone || "—"]);
    rows.push(["Status", statusLabel]);
    rows.push(["Mediator", c.mediator || "—"]);
    rows.push([
      "Commission (₹)",
      c.commission ? "₹" + c.commission : "—",
    ]);
    rows.push(["Closure Date", closureDisplay]);

    /* Section 2: Plot Info */
    rows.push([]);
    rows.push(["PLOT DETAILS"]);
    rows.push([]);

    rows.push(["Plot Number", c.plotLabel || "—"]);
    rows.push(["Facing", plot ? plot.facing || "—" : "—"]);
    rows.push(["Area (sq.ft)", plot && plot.sqft ? plot.sqft + " sq.ft" : "—"]);
    rows.push([
      "Plot Price (₹)",
      c.bookingAmount
        ? "₹" + c.bookingAmount
        : "—",
    ]);
    rows.push([
      "Cent",
      plot && plot.sqft ? (plot.sqft / 435.6).toFixed(2) + " Cent" : "—",
    ]);

    /* Section 3: Installments — only if they exist */
    if (hasInstallments) {
      rows.push([]);
      rows.push(["PAYMENT INSTALLMENTS", "", "", "", "", "", ""]);
      rows.push([]);
      rows.push([
        "S.No.",
        "Amount Received (₹)",
        "Date Received",
        "Next Follow-up Date",
        "",
        "",
        "",
      ]);

      var total = 0;
      c.installments.forEach(function (inst, i) {
        var amt = parseFloat(String(inst.amount).replace(/,/g, "")) || 0;
        total += amt;

        var dateDisplay = "—";
        if (inst.date) {
          var d2 = new Date(inst.date + "T00:00:00");
          dateDisplay = d2.toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          });
        }
        var followDisplay = "—";
        if (inst.followUp) {
          var d3 = new Date(inst.followUp + "T00:00:00");
          followDisplay = d3.toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          });
        }

        rows.push([
          i + 1,
          "₹" + amt,
          dateDisplay,
          followDisplay,
          "",
          "",
          "",
        ]);
      });

      rows.push([]);
      rows.push([
        "",
        "Total Paid:",
        "₹" + total,
        "",
        "",
        "",
        "",
      ]);
    }

    /* ── Convert to CSV ── */
    var csv = rows
      .map(function (row) {
        return row
          .map(function (cell) {
            return (
              '"' +
              String(cell === undefined || cell === null ? "" : cell).replace(
                /"/g,
                '""',
              ) +
              '"'
            );
          })
          .join(",");
      })
      .join("\n");

    /* ── Download ── */
    var filename =
      "Customer_" +
      (c.customerName || "Details").replace(/\s+/g, "_") +
      "_" +
      (c.plotLabel || "Plot").replace(/\s+/g, "_") +
      ".csv";

    var blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    showToast("✅ Exported: " + filename);
  }
  /* ── Mediator Dashboard ── */
  function renderMediatorDashTable() {
    filterDashTable("mediator");
  }
  function renderMediatorRows(data) {
    var tbody = document.getElementById("mediatorDashBody");
    if (data.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="4" style="text-align:center;color:#aaa;padding:28px 0;font-size:13px;">No mediators found.</td></tr>';
      return;
    }
    tbody.innerHTML = "";
    data.forEach(function (m, i) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" +
        (i + 1) +
        "</td><td>" +
        escapeHTML(m.name) +
        "</td><td>" +
        escapeHTML(m.phone || "—") +
        "</td><td>" +
        escapeHTML(m.location || "—") +
        "</td>";
      tbody.appendChild(tr);
    });
  }

  /* ── Plot Dashboard ── */
  function renderPlotDashTable() {
    filterDashTable("plot");
  }
  function renderPlotRows(data) {
    var tbody = document.getElementById("plotDashBody");
    if (data.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="8" style="text-align:center;color:#aaa;padding:28px 0;font-size:13px;">No plots found.</td></tr>';
      return;
    }
    tbody.innerHTML = "";
    data.forEach(function (p, i) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" +
        (i + 1) +
        "</td><td><strong>" +
        escapeHTML(p.title || "—") +
        "</strong></td>" +
        "<td>₹" +
        (p.price ? Number(p.price).toLocaleString("en-IN") : "—") +
        "</td>" +
        "<td>" +
        (p.sqft || "—") +
        "</td>" +
        "<td>" +
        escapeHTML(p.facing || "—") +
        "</td><td>" +
        escapeHTML(p.status || "—") +
        "</td>";
      tbody.appendChild(tr);
    });
  }

  /* ── Filter ── */
  window.filterDashTable = function (tab) {
    console.log(tab);
    if (tab === "customer") {
      var searchEl = document.getElementById("cust-search");
      var statusEl = document.getElementById("cust-status-filter");
      var dateEl = document.getElementById("cust-date-filter");
      var followEl = document.getElementById("cust-followup-filter");

      if (!searchEl || !statusEl || !dateEl || !followEl) return;

      var q = (searchEl.value || "").toLowerCase();
      var sf = (statusEl.value || "").toLowerCase();
      var df = dateEl.value || "";
      var ff = followEl.value || "";

      var filtered = customerStore.filter(function (c) {
        var cStatus = (c.status || "").toLowerCase();
        var match =
          !q ||
          (c.customerName || "").toLowerCase().includes(q) ||
          (c.customerPhone || "").toLowerCase().includes(q) ||
          (c.plotLabel || "").toLowerCase().includes(q) ||
          (c.mediator || "").toLowerCase().includes(q);
        var statusMatch = !sf || cStatus === sf;
        var dateMatch = !df || c.closureDate === df;
        var followUpMatch =
          !ff ||
          (c.installments || []).some(function (i) {
            return i.followUp === ff;
          });
        return match && statusMatch && dateMatch && followUpMatch;
      });

      renderCustomerRows(filtered);
    } else if (tab === "mediator") {
      var medSearchEl = document.getElementById("med-search");
      if (!medSearchEl) return;

      var q2 = (medSearchEl.value || "").toLowerCase();
      var filtered2 = knownMediators.filter(function (m) {
        return (
          !q2 ||
          (m.name || "").toLowerCase().includes(q2) ||
          (m.phone || "").toLowerCase().includes(q2) ||
          (m.location || "").toLowerCase().includes(q2)
        );
      });
      renderMediatorRows(filtered2);
    } else if (tab === "plot") {
      var plotSearchEl = document.getElementById("plot-search");
      var plotStatusEl = document.getElementById("plot-status-filter");
      if (!plotSearchEl || !plotStatusEl) return;

      var q3 = (plotSearchEl.value || "").toLowerCase();
      var sf3 = (plotStatusEl.value || "").toLowerCase();
      var filtered3 = Object.values(plotDB).filter(function (p) {
        var match = !q3 || (p.title || "").toLowerCase().includes(q3);
        var statusMatch = !sf3 || (p.status || "").toLowerCase() === sf3;
        return match && statusMatch;
      });
      renderPlotRows(filtered3);
    }
  };

  /* ── Excel Export ── */
  window.exportToExcel = function (tab) {
    var rows = [],
      headers = [],
      filename = "";
    if (tab === "customer") {
      headers = [
        "S.No.",
        "Customer Name",
        "Phone",
        "Plot",
        "Booking Amount (₹)",
        "Mediator",
        "Commission (₹)",
        "Closure Date",
        "Status",
        "Installment #",
        "Amount Received (₹)",
        "Date Received",
        "Next Follow-up Date",
      ];
      filename = "Customer_Details.csv";
      var sno = 0;
      customerStore.forEach(function (c) {
        sno++;
        var sl =
          c.status === "registered" || c.status === "register"
            ? "Registration Done"
            : c.status === "booked" || c.status === "progress"
              ? "Booked"
              : c.status === "reserved"
                ? "Reserved"
                : c.status || "";
        var baseRow = [
          sno,
          c.customerName || "",
          c.customerPhone || "",
          c.plotLabel || "",
          c.bookingAmount || "",
          c.mediator || "",
          c.commission || "",
          c.closureDate || "",
          sl,
        ];
        if (!c.installments || c.installments.length === 0) {
          rows.push(baseRow.concat(["", "", "", ""]));
        } else
          c.installments.forEach(function (inst, i) {
            rows.push(
              baseRow.concat([
                i + 1,
                inst.amount || "",
                inst.date || "",
                inst.followUp || "",
              ]),
            );
          });
      });
    } else if (tab === "mediator") {
      headers = ["S.No.", "Mediator Name", "Phone Number", "Location"];
      filename = "Mediator_Details.csv";
      knownMediators.forEach(function (m, i) {
        rows.push([i + 1, m.name || "", m.phone || "", m.location || ""]);
      });
    } else if (tab === "plot") {
      headers = [
        "S.No.",
        "Plot Number",
        "Plot Price",
        "Length (ft)",
        "Width (ft)",
        "Sq. Feet",
        "Plot Facing",
        "Status",
      ];
      filename = "Plot_Price_Details.csv";
      Object.values(plotDB).forEach(function (p, i) {
        rows.push([
          i + 1,
          p.title || "",
          p.price || "",
          p.length || "",
          p.width || "",
          p.sqft || "",
          p.facing || "",
          p.status || "",
        ]);
      });
    }
    var csv = [headers]
      .concat(rows)
      .map(function (r) {
        return r
          .map(function (v) {
            return '"' + String(v).replace(/"/g, '""') + '"';
          })
          .join(",");
      })
      .join("\n");
    var blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast("✅ Exported " + filename);
  };

  /* ══════════════════════════════════════════════════
       FETCH SVG → INJECT INLINE
    ══════════════════════════════════════════════════ */
  function loadSVG() {
    fetch(SVG_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
      })
      .then(function (svgText) {
        svgContainer.innerHTML = svgText;
        inlineSvg = svgContainer.querySelector("svg");
        if (!inlineSvg) throw new Error("No <svg> found.");
        if (!inlineSvg.getAttribute("viewBox")) {
          var w = parseFloat(inlineSvg.getAttribute("width") || 700);
          var h = parseFloat(inlineSvg.getAttribute("height") || 500);
          inlineSvg.setAttribute("viewBox", "0 0 " + w + " " + h);
        }
        var vb = inlineSvg.viewBox.baseVal;
        origVbX = vb.x;
        origVbY = vb.y;
        origVbW = vb.width;
        origVbH = vb.height;
        vbX = origVbX;
        vbY = origVbY;
        vbW = origVbW;
        vbH = origVbH;
        inlineSvg.setAttribute("width", "100%");
        inlineSvg.setAttribute("height", "100%");
        inlineSvg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        inlineSvg.style.display = "block";
        applyInitialStatuses();
        setupPlotHandlers();
        loading.classList.add("hidden");
        applyVB();
      })
      .catch(function (err) {
        console.error(err);
        loading.innerHTML = "❌ " + err.message;
      });
  }

  /* ══════════════════════════════════════════════════
       PLOT CLICK + HOVER
    ══════════════════════════════════════════════════ */
  /* ══════════════════════════════════════════════════
       PLOT CLICK + HOVER
    ══════════════════════════════════════════════════ */
  function setupPlotHandlers() {
    Object.keys(plotDB).forEach(function (plotId) {
      var d = plotDB[plotId];
      var overlay = inlineSvg.getElementById(plotId);
      var visible =
        (d.visibleId ? inlineSvg.getElementById(d.visibleId) : null) ||
        inlineSvg.getElementById("Plot-" + d.plotNum) ||
        overlay;
      if (!overlay) {
        console.warn("Overlay not found:", plotId);
        return;
      }
      overlay.style.cursor = "pointer";
      var justTapped = false;

      function handleActivate(e) {
        if (dragMoved > CLICK_THRESH) return;
        e.stopPropagation();

        /* 🔒 NOT LOGGED IN → show plot image popup for customer */
        if (!isLoggedIn) {
          openPlotImagePopup(plotId, d);
          return;
        }

        /* ✅ LOGGED IN → open admin popup as before */
        selectedPlot = visible;
        originalColor = visible
          ? visible.getAttribute("fill") || visible.style.fill || ""
          : "";
        hideTT();
        openPopup(plotId);
      }

      /* ══════════════════════════════════════════════════
               CUSTOMER PLOT IMAGE POPUP
            ══════════════════════════════════════════════════ */
      function openPlotImagePopup(plotId, plotData) {
        var plotNum = plotData.plotNum || plotId.match(/\d+/)[0];
        var title = plotData.title || "Plot " + plotNum;

        // Set title
        document.getElementById("plot-img-title").textContent = title;

        // ✅ Populate detail cards
        var sqft = plotData.sqft ? plotData.sqft + " sq.ft" : "—";
        var cent = plotData.sqft
          ? (plotData.sqft / 435.6).toFixed(2) + " Cent"
          : "—";
        var price = plotData.price
          ? "₹" + Number(plotData.price).toLocaleString("en-IN") + " / Cent"
          : "—";
        var facing = plotData.facing || "—";

        var statusRaw = plotData.status || "Available";
        var statusColors = {
          available: { bg: "#e6fff2", color: "#1a7a3a", text: "✅ Available" },
          booked: { bg: "#e79a86", color: "#7a0000", text: "🔖 Booked" },
          reserved: { bg: "#fff8e1", color: "#a07800", text: "🔖 Reserved" },
          "registration done": {
            bg: "#fdecea",
            color: "#7a0000",
            text: "🏛 Registered",
          },
          "booked-registered": {
            bg: "#fdecea",
            color: "#7a0000",
            text: "🏛 Registered",
          },
        };
        var sc = statusColors[statusRaw.toLowerCase()] || {
          bg: "#f0f0f0",
          color: "#555",
          text: statusRaw,
        };

        document.getElementById("pid-sqft").textContent = sqft;
        document.getElementById("pid-cent").textContent = cent;
        document.getElementById("pid-price").textContent = price;
        document.getElementById("pid-facing").textContent = facing;

        var statusEl = document.getElementById("pid-status");
        statusEl.textContent = sc.text;
        statusEl.style.background = sc.bg;
        statusEl.style.color = sc.color;
        statusEl.style.padding = "4px 10px";
        statusEl.style.borderRadius = "20px";
        statusEl.style.fontWeight = "700";
        statusEl.style.fontSize = "12px";

        // Set image
        var imgEl = document.getElementById("plot-img-el");
        var errEl = document.getElementById("plot-img-err");
        imgEl.style.display = "block";
        errEl.style.display = "none";
        imgEl.src = "src/Plot-img-" + plotNum + ".png";
        /* Clear enquiry form on each open */
        document.getElementById("enq-name").value = "";
        document.getElementById("enq-phone").value = "";
        document.getElementById("enq-address").value = "";

        document.getElementById("plot-img-popup").classList.add("show");
      }

      function closePlotImagePopup() {
        var popup = document.getElementById("plot-img-popup");
        popup.classList.remove("show");
        /* Clear src after close to avoid stale image flash */
        setTimeout(function () {
          document.getElementById("plot-img-el").src = "";
          document.getElementById("plot-img-err").style.display = "none";
          document.getElementById("plot-img-el").style.display = "block";
        }, 250);
      }

      /* Wire up close button + backdrop click + Escape */
      document
        .getElementById("plot-img-close")
        .addEventListener("click", closePlotImagePopup);

      /* ── Enquiry form submit ── */
      document
        .getElementById("enq-submit-btn")
        .addEventListener("click", function () {
          var name = (document.getElementById("enq-name").value || "").trim();
          var phone = (document.getElementById("enq-phone").value || "").trim();
          var address = (
            document.getElementById("enq-address").value || ""
          ).trim();

          if (!name) {
            document.getElementById("enq-name").focus();
            showToast("⚠️ Please enter your name");
            return;
          }
          if (!phone || phone.length !== 10) {
            document.getElementById("enq-phone").focus();
            showToast("⚠️ Please enter a valid 10-digit mobile number");
            return;
          }

          /* Clear form */
          document.getElementById("enq-name").value = "";
          document.getElementById("enq-phone").value = "";
          document.getElementById("enq-address").value = "";

          closePlotImagePopup();
          showToast("✅ Enquiry submitted! We'll contact you soon.");
        });

      /* Phone only digits for enquiry */
      document
        .getElementById("enq-phone")
        .addEventListener("input", function () {
          this.value = this.value.replace(/\D/g, "").slice(0, 10);
        });

      document
        .getElementById("plot-img-popup")
        .addEventListener("click", function (e) {
          if (e.target === this) closePlotImagePopup();
        });

      /* Extend existing Escape listener (or add new) */
      window.addEventListener("keydown", function (e) {
        if (
          e.key === "Escape" &&
          document.getElementById("plot-img-popup").classList.contains("show")
        ) {
          closePlotImagePopup();
        }
      });

      overlay.addEventListener("touchend", function (e) {
        if (dragMoved > CLICK_THRESH) return;
        justTapped = true;
        setTimeout(function () {
          justTapped = false;
        }, 500);
        handleActivate(e);
      });
      overlay.addEventListener("click", function (e) {
        if (justTapped) return;
        handleActivate(e);
      });
      overlay.addEventListener("mouseenter", function (e) {
        if (isOpen()) return;
        var sc =
          (d.status || "").toLowerCase() === "available"
            ? "#5ee87a"
            : (d.status || "").toLowerCase() === "reserved"
              ? "#FFD253"
              : "#ff8080";

        // ✅ Find customer for this plot — only show if admin is logged in
        var custLine = "";
        if (isLoggedIn) {
          var cust = customerStore.find(function (c) {
            return c.plotLabel === d.title || c.plotKey === plotId;
          });
          if (cust && cust.customerName) {
            var phone = cust.customerPhone
              ? " (" + cust.customerPhone + ")"
              : "";
            custLine =
              '<br>👤 <span style="color:#ffffff;font-weight:600;">' +
              escapeHTML(cust.customerName) +
              escapeHTML(phone) +
              "</span>";
          }
        }

        showTT(
          '<strong style="font-size:14px;">' +
            d.title +
            "</strong><br>" +
            "📐 " +
            d.sqft +
            " sq.ft (" +
            d.length +
            " × " +
            d.width +
            " ft)<br>" +
            "📏 " +
            (d.sqft / 435.6).toFixed(2) +
            " Cent<br>" +
            "💰 ₹" +
            Number(d.price).toLocaleString("en-IN") + " / Cent" +
            "<br>" +
            "🧭 Facing: " +
            d.facing +
            "<br>" +
            '📋 <span style="color:' +
            sc +
            ';font-weight:700;">' +
            d.status +
            "</span>" +
            custLine,
          e.clientX,
          e.clientY,
        );
      });
      overlay.addEventListener("mousemove", function (e) {
        if (isOpen() || tooltip.style.display === "none") return;
        posTT(e.clientX, e.clientY);
      });
      overlay.addEventListener("mouseleave", hideTT);
    });
  }

  /* ══════════════════════════════════════════════════
       ZOOM & PAN
    ══════════════════════════════════════════════════ */
  function zoomAt(f, sx, sy) {
    var cz = getZoom(),
      nz = clampZ(cz * f),
      af = nz / cz;
    var pt = s2svg(sx, sy),
      nW = vbW / af,
      nH = vbH / af;
    var rx = (pt.x - vbX) / vbW,
      ry = (pt.y - vbY) / vbH;
    vbX = pt.x - rx * nW;
    vbY = pt.y - ry * nH;
    vbW = nW;
    vbH = nH;
    applyVB();
  }
  function zoomC(f) {
    var r = inlineSvg.getBoundingClientRect();
    zoomAt(f, r.left + r.width / 2, r.top + r.height / 2);
  }
  function resetV() {
    vbX = origVbX;
    vbY = origVbY;
    vbW = origVbW;
    vbH = origVbH;
    applyVB();
  }
  function fitV() {
    var p = 0.02;
    vbX = origVbX - origVbW * p;
    vbY = origVbY - origVbH * p;
    vbW = origVbW * (1 + p * 2);
    vbH = origVbH * (1 + p * 2);
    applyVB();
  }

  viewport.addEventListener(
    "wheel",
    function (e) {
      e.preventDefault();
      if (isOpen() || !inlineSvg) return;
      zoomAt(
        Math.min(3, Math.max(0.1, 1 + -e.deltaY * ZOOM_SPEED)),
        e.clientX,
        e.clientY,
      );
    },
    { passive: false },
  );

  var dragging = false,
    dsx = 0,
    dsy = 0,
    dvx = 0,
    dvy = 0,
    dragMoved = 0,
    CLICK_THRESH = 4;
  viewport.addEventListener("mousedown", function (e) {
    if (e.button !== 0 || isOpen() || !inlineSvg) return;
    dragging = true;
    dsx = e.clientX;
    dsy = e.clientY;
    dvx = vbX;
    dvy = vbY;
    dragMoved = 0;
    viewport.classList.add("is-dragging");
    e.preventDefault();
  });
  window.addEventListener("mousemove", function (e) {
    if (!dragging || !inlineSvg) return;
    var dx = e.clientX - dsx,
      dy = e.clientY - dsy;
    dragMoved = Math.abs(dx) + Math.abs(dy);
    var r = inlineSvg.getBoundingClientRect();
    vbX = dvx - (dx / r.width) * vbW;
    vbY = dvy - (dy / r.height) * vbH;
    applyVB();
  });
  window.addEventListener("mouseup", function () {
    if (!dragging) return;
    dragging = false;
    viewport.classList.remove("is-dragging");
  });
  viewport.addEventListener(
    "click",
    function (e) {
      if (dragMoved > CLICK_THRESH) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );

  var ltd = 0,
    lmx = 0,
    lmy = 0,
    tsx = 0,
    tsy = 0,
    tvx = 0,
    tvy = 0;
  function tdist(a, b) {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  viewport.addEventListener(
    "touchstart",
    function (e) {
      if (isOpen() || !inlineSvg) return;
      e.preventDefault();
      if (e.touches.length === 2) {
        ltd = tdist(e.touches[0], e.touches[1]);
        lmx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        lmy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      } else {
        tsx = e.touches[0].clientX;
        tsy = e.touches[0].clientY;
        tvx = vbX;
        tvy = vbY;
        dragMoved = 0;
      }
    },
    { passive: false },
  );
  viewport.addEventListener(
    "touchmove",
    function (e) {
      if (isOpen() || !inlineSvg) return;
      e.preventDefault();
      if (e.touches.length === 2) {
        var d = tdist(e.touches[0], e.touches[1]);
        var mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        var my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        if (ltd > 0) {
          zoomAt(d / ltd, mx, my);
          var r = inlineSvg.getBoundingClientRect();
          vbX -= ((mx - lmx) / r.width) * vbW;
          vbY -= ((my - lmy) / r.height) * vbH;
          applyVB();
        }
        ltd = d;
        lmx = mx;
        lmy = my;
      } else {
        var dx = e.touches[0].clientX - tsx,
          dy = e.touches[0].clientY - tsy;
        dragMoved = Math.abs(dx) + Math.abs(dy);
        var r2 = inlineSvg.getBoundingClientRect();
        vbX = tvx - (dx / r2.width) * vbW;
        vbY = tvy - (dy / r2.height) * vbH;
        applyVB();
      }
    },
    { passive: false },
  );
  viewport.addEventListener("touchend", function () {
    ltd = 0;
  });

  window.addEventListener("keydown", function (e) {
    if (isOpen() || !inlineSvg) return;
    var s = vbW * 0.08;
    switch (e.key) {
      case "+":
      case "=":
        zoomC(1.2);
        break;
      case "-":
      case "_":
        zoomC(0.83);
        break;
      case "0":
        resetV();
        break;
      case "ArrowUp":
        vbY -= s;
        applyVB();
        e.preventDefault();
        break;
      case "ArrowDown":
        vbY += s;
        applyVB();
        e.preventDefault();
        break;
      case "ArrowLeft":
        vbX -= s;
        applyVB();
        e.preventDefault();
        break;
      case "ArrowRight":
        vbX += s;
        applyVB();
        e.preventDefault();
        break;
    }
  });
  document.getElementById("btn-zoom-in").addEventListener("click", function () {
    if (inlineSvg) zoomC(1.3);
  });
  document
    .getElementById("btn-zoom-out")
    .addEventListener("click", function () {
      if (inlineSvg) zoomC(0.77);
    });
  document.getElementById("btn-fit").addEventListener("click", function () {
    if (inlineSvg) fitV();
  });

  /* ══════════════════════════════════════════════════
       AUTH
    ══════════════════════════════════════════════════ */
  var isLoggedIn = false,
    currentUser = null;
  var loginModal = document.getElementById("login-modal");
  var loginClose = document.getElementById("login-close");
  var loginSubmit = document.getElementById("login-submit");
  var loginUsername = document.getElementById("login-username");
  var loginPassword = document.getElementById("login-password");
  var loginError = document.getElementById("login-error");
  var loginBtnText = document.getElementById("login-btn-text");
  var loginSpinner = document.getElementById("login-spinner");
  var togglePwd = document.getElementById("toggle-password");
  var btnLogin = document.getElementById("btn-login");
  var btnProfile = document.getElementById("btn-profile");
  var btnProfileAvt = document.getElementById("btn-profile-avatar");
  var btnProfileName = document.getElementById("btn-profile-name");
  var profileDropdown = document.getElementById("profile-dropdown");
  var profileAvatar = document.getElementById("profile-avatar");
  var profileName = document.getElementById("profile-name");
  var btnLogout = document.getElementById("btn-logout");

  function openLoginModal() {
    loginUsername.value = "";
    loginPassword.value = "";
    loginError.classList.remove("show");
    loginModal.classList.add("show");
    setTimeout(function () {
      loginUsername.focus();
    }, 100);
  }
  function closeLoginModal() {
    loginModal.classList.remove("show");
  }

  async function doLogin() {
    var uname = loginUsername.value.trim().toLowerCase(),
      pwd = loginPassword.value;
    loginBtnText.style.display = "none";
    loginSpinner.style.display = "inline-block";
    loginError.classList.remove("show");
    try {
      var result = await apiFetch("/auth/login", {
        method: "POST",
        body: { username: uname, password: pwd },
      });
      currentUser = {
        username: uname,
        displayName: result.displayName,
        role: result.role,
      };
      isLoggedIn = true;
      closeLoginModal();
      setLoggedInUI();
      await loadCustomers();
    } catch (err) {
      loginError.classList.add("show");
      loginPassword.value = "";
      loginPassword.focus();
    } finally {
      loginBtnText.style.display = "";
      loginSpinner.style.display = "none";
    }
  }

  function setLoggedInUI() {
    var initial = ((currentUser && currentUser.displayName) || "U")
      .charAt(0)
      .toUpperCase();
    btnLogin.style.display = "none";
    btnProfile.style.display = "flex";
    btnProfileAvt.textContent = initial;
    btnProfileName.textContent = currentUser ? currentUser.displayName : "";
    profileAvatar.textContent = initial;
    profileName.textContent = currentUser ? currentUser.displayName : "";
    document.body.classList.remove("not-logged-in");
    document.body.classList.add("logged-in");
    btnDashboard.style.display = "flex";
    /* ── Hide About Us button for admin ── */
    var aboutBtn = document.getElementById("btn-about-us");
    if (aboutBtn) aboutBtn.style.display = "none";
  }

  async function doLogout() {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch (e) {}
    isLoggedIn = false;
    currentUser = null;
    btnLogin.style.display = "";
    btnProfile.style.display = "none";
    profileDropdown.classList.remove("show");
    document.body.classList.add("not-logged-in");
    document.body.classList.remove("logged-in");
    customerStore = [];

      /* ── Show About Us button again for public view ── */
    var aboutBtn = document.getElementById("btn-about-us");
    if (aboutBtn) aboutBtn.style.display = "";
  }

  document.body.classList.add("not-logged-in");
  btnLogin.addEventListener("click", openLoginModal);
  loginClose.addEventListener("click", closeLoginModal);
  loginModal.addEventListener("click", function (e) {
    if (e.target === loginModal) closeLoginModal();
  });
  loginSubmit.addEventListener("click", doLogin);
  loginUsername.addEventListener("keydown", function (e) {
    if (e.key === "Enter") loginPassword.focus();
  });
  loginPassword.addEventListener("keydown", function (e) {
    if (e.key === "Enter") doLogin();
  });
  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (loginModal.classList.contains("show")) closeLoginModal();
      if (profileDropdown.classList.contains("show"))
        profileDropdown.classList.remove("show");
    }
  });
  togglePwd.addEventListener("click", function () {
    var isPwd = loginPassword.type === "password";
    loginPassword.type = isPwd ? "text" : "password";
    document.getElementById("eye-icon").style.opacity = isPwd ? "0.4" : "1";
  });
  btnProfile.addEventListener("click", function (e) {
    e.stopPropagation();
    profileDropdown.classList.toggle("show");
  });
  document.addEventListener("click", function (e) {
    if (!profileDropdown.contains(e.target) && e.target !== btnProfile)
      profileDropdown.classList.remove("show");
  });
  // btnLogout.addEventListener("click", function () {
  //   doLogout();
  //   showToast("👋 Logged out successfully");

  // });
btnLogout.addEventListener("click", function () {
  doLogout();
  showToast("👋 Logged out successfully");

  // Hide dashboard button

  if (btnDashboard ) {
    btnDashboard .style.display = "none";
  }
});


  /* ══════════════════════════════════════════════════
       MEDIATOR TAB
    ══════════════════════════════════════════════════ */
  var mediatorRecords = {};

  function buildMedDatalist() {
    var dl = document.getElementById("med-name-list");
    if (!dl) return;
    dl.innerHTML = "";
    knownMediators.forEach(function (m) {
      var opt = document.createElement("option");
      opt.value = m.name;
      dl.appendChild(opt);
    });
  }

  document.getElementById("medName").addEventListener("input", function () {
    var val = this.value.trim().toLowerCase();
    var found = knownMediators.find(function (m) {
      return m.name.toLowerCase() === val;
    });
    if (found) {
      document.getElementById("medPhone").value = found.phone || "";
      document.getElementById("medLocation").value = found.location || "";
    }
  });

  document
    .getElementById("btnAddMedRow")
    .addEventListener("click", async function () {
      var name = document.getElementById("medName").value.trim();
      var phone = document.getElementById("medPhone").value.trim();
      var location = document.getElementById("medLocation").value.trim();
      if (!name) {
        document.getElementById("medName").focus();
        showToast("⚠️ Please enter a mediator name");
        return;
      }
      if (phone && phone.length !== 10) {
        document.getElementById("medPhone").focus();
        showToast("⚠️ Phone must be 10 digits");
        return;
      }

      try {
        await apiFetch("/mediators", {
          method: "POST",
          body: { name, phone, location },
        });
      } catch (err) {
        console.warn("Mediator save failed:", err.message);
      }

      if (
        !knownMediators.find(function (m) {
          return m.name.toLowerCase() === name.toLowerCase();
        })
      ) {
        knownMediators.push({ name, phone, location });
        buildMedDatalist();
      }
      if (!mediatorRecords[currentPlotId]) mediatorRecords[currentPlotId] = [];
      mediatorRecords[currentPlotId].push({ name, phone, location });
      renderMedTable();
      syncMedToCustomerDropdown();
      document.getElementById("medName").value = "";
      document.getElementById("medPhone").value = "";
      document.getElementById("medLocation").value = "";
      document.getElementById("medName").focus();
      showToast("✅ Mediator added: " + name);
    });

  syncMedToCustomerDropdown();

  function renderMedTable() {
    var tbody = document.getElementById("medTableBody");
    var plotSpecific = mediatorRecords[currentPlotId] || [];
    var summary = document.getElementById("medSummary");
    tbody.innerHTML = "";

    /* Show global knownMediators list with delete option */
    var allToShow = knownMediators.slice();

    /* Also add any plot-specific ones added this session that aren't in global list */
    plotSpecific.forEach(function (rec) {
      if (
        !allToShow.find(function (m) {
          return m.name.toLowerCase() === rec.name.toLowerCase();
        })
      ) {
        allToShow.push(rec);
      }
    });

    if (allToShow.length === 0) {
      tbody.innerHTML =
        '<tr class="med-empty-row"><td colspan="5"><div class="med-table-empty"><span>🤝</span><p>No mediator entries yet. Add one above.</p></div></td></tr>';
      summary.style.display = "none";
      return;
    }

    allToShow.forEach(function (rec, idx) {
      var initial = rec.name.charAt(0).toUpperCase();
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" +
        (idx + 1) +
        "</td>" +
        '<td><div class="td-name">' +
        escHtml(rec.name) +
        "</span></div></td>" +
        "<td>" +
        (rec.phone
          ? escHtml(rec.phone)
          : '<span style="color:#bbb;">—</span>') +
        "</td>" +
        "<td>" +
        (rec.location
          ? escHtml(rec.location)
          : '<span style="color:#bbb;">—</span>') +
        "</td>" +
        '<td><button class="med-del-btn" data-name="' +
        escHtml(rec.name) +
        '" title="Delete Mediator">Delete</button></td>';

      tr.querySelector(".med-del-btn").addEventListener(
        "click",
        async function () {
          var mname = this.getAttribute("data-name");
          if (!confirm('Delete mediator "' + mname + '" from the system?'))
            return;
          /* Find by name in knownMediators */
          var mObj = knownMediators.find(function (m) {
            return m.name === mname;
          });
          if (mObj && mObj.id) {
            try {
              await apiFetch("/mediators/" + mObj.id, { method: "DELETE" });
            } catch (err) {
              console.warn("Delete mediator API error:", err.message);
            }
          }
          /* Remove from local arrays */
          knownMediators = knownMediators.filter(function (m) {
            return m.name !== mname;
          });
          if (mediatorRecords[currentPlotId]) {
            mediatorRecords[currentPlotId] = mediatorRecords[
              currentPlotId
            ].filter(function (m) {
              return m.name !== mname;
            });
          }
          buildMedDatalist();
          renderMedTable();
          syncMedToCustomerDropdown();
          showToast('🗑 Mediator "' + mname + '" deleted');
        },
      );
      tbody.appendChild(tr);
    });

    document.getElementById("medSumCount").textContent = allToShow.length;
    summary.style.display = "grid";
  }

  function syncMedToCustomerDropdown() {
    var sel = document.getElementById("mediatorSel");
    var records = mediatorRecords[currentPlotId] || [];
    var prev = sel.value;
    sel.innerHTML = '<option value="">— Select Mediator —</option>';
    records.forEach(function (rec) {
      var opt = document.createElement("option");
      opt.value = rec.name;
      opt.textContent = rec.name + (rec.phone ? " (" + rec.phone + ")" : "");
      sel.appendChild(opt);
    });
    knownMediators.forEach(function (m) {
      if (
        !records.some(function (r) {
          return r.name.toLowerCase() === m.name.toLowerCase();
        })
      ) {
        var opt = document.createElement("option");
        opt.value = m.name;
        opt.textContent = m.name;
        sel.appendChild(opt);
      }
    });
    var other = document.createElement("option");
    other.value = "other";
    other.textContent = "Other (type below)…";
    sel.appendChild(other);
    if (prev) sel.value = prev;
  }

  document
    .getElementById("mediatorSel")
    .addEventListener("change", function () {
      var show = this.value === "other";
      document.getElementById("mediatorOther").style.display = show
        ? "block"
        : "none";
      if (show) document.getElementById("mediatorOther").focus();
    });

  document.getElementById("btnSaveMed").addEventListener("click", function () {
    var records = mediatorRecords[currentPlotId] || [];
    if (records.length === 0 && knownMediators.length === 0) {
      showToast("⚠️ No mediator entries to save");
      return;
    }
    showToast("✅ Mediator details noted");
    closePopup();
  });

  function resetMedTab() {
    document.getElementById("medName").value = "";
    document.getElementById("medPhone").value = "";
    document.getElementById("medLocation").value = "";
    renderMedTable();
  }

  /* Phone enforcement */
  function enforcePhone(inputEl) {
    inputEl.addEventListener("input", function () {
      this.value = this.value.replace(/\D/g, "");
      if (this.value.length > 10) this.value = this.value.slice(0, 10);
    });
    inputEl.addEventListener("keypress", function (e) {
      if (!/[0-9]/.test(e.key)) e.preventDefault();
      if (this.value.length >= 10) e.preventDefault();
    });
  }
  enforcePhone(document.getElementById("custPhone"));
  enforcePhone(document.getElementById("medPhone"));

  buildMedDatalist();

  // ✅ Indian comma formatting — live as you type (12,50,000)
  function enforceIndianPrice(inputEl) {
    inputEl.addEventListener("input", function () {
      var el = this;
      var cursorPos = el.selectionStart;
      var oldLen = el.value.length;

      // Remove all non-digit and non-dot characters
      var raw = el.value.replace(/,/g, "").replace(/[^0-9.]/g, "");

      // Allow only one decimal point
      var dotIdx = raw.indexOf(".");
      if (dotIdx !== -1) {
        raw =
          raw.substring(0, dotIdx + 1) +
          raw.substring(dotIdx + 1).replace(/\./g, "");
      }

      var parts = raw.split(".");
      var intPart = parts[0] || "";
      var decPart = parts.length > 1 ? "." + parts[1] : "";

      // Indian format: last 3 digits, then pairs of 2 from right
      var formatted = intPart;
      if (intPart.length > 3) {
        var last3 = intPart.slice(-3);
        var rest = intPart.slice(0, -3);
        // Group rest into pairs of 2 from the right
        var restFormatted = "";
        while (rest.length > 2) {
          restFormatted = "," + rest.slice(-2) + restFormatted;
          rest = rest.slice(0, -2);
        }
        restFormatted = rest + restFormatted;
        formatted = restFormatted + "," + last3;
      }

      el.value = formatted + decPart;

      // Fix cursor position after commas shift the text
      var newLen = el.value.length;
      var diff = newLen - oldLen;
      var newCursor = Math.max(0, cursorPos + diff);
      el.setSelectionRange(newCursor, newCursor);
    });
  }

  // ✅ Plain decimal for cent and sqft
  function enforceDecimal(inputEl) {
    inputEl.addEventListener("input", function () {
      this.value = this.value.replace(/[^0-9.]/g, "");
      var parts = this.value.split(".");
      if (parts.length > 2) {
        this.value = parts[0] + "." + parts.slice(1).join("");
      }
    });
  }

  // Apply to fields
  enforceIndianPrice(document.getElementById("plotPrice"));
  enforceIndianPrice(document.getElementById("bookingPrice")); // ✅ Customer tab booking price
  enforceIndianPrice(document.getElementById("custMedAmount")); // ✅ Commission field
  enforceIndianPrice(document.getElementById("plotCent"));
  enforceIndianPrice(document.getElementById("plotSqft"));

  /* Preloader */
  var preloader = document.getElementById("preloader");
  var progress = document.getElementById("progress");
  var percentage = document.getElementById("percentage");
  var width = 0;
  var interval = setInterval(function () {
    width += 2;
    progress.style.width = width + "%";
    percentage.textContent = width + "%";
    if (width >= 100) {
      clearInterval(interval);
      setTimeout(function () {
        preloader.classList.add("hidden");
      }, 300);
    }
  }, 30);

  /* Also need to add mediator IDs when loading from API */
  async function loadMediatorsWithIds() {
    try {
      var meds = await apiFetch("/mediators");
      knownMediators = meds; // meds from API include {id, name, phone, location}
      buildMedDatalist();
      syncMedToCustomerDropdown();
    } catch (err) {
      console.warn("Could not reload mediators");
    }
  }

  /* Kick off */
  bootstrap();

  async function loadDashboardStats() {
    try {
      const res = await fetch("/api/plots");
      const plots = await res.json();

      updateStats(plots);
    } catch (err) {
      console.error("Failed to load stats:", err);
    }
  }

  document.addEventListener("DOMContentLoaded", loadDashboardStats);

  function updateStats(plotDB) {
    let total = 0,
      booked = 0,
      available = 0,
      reserved = 0,
      bookedRegistered = 0;

    Object.values(plotDB).forEach(function (plot) {
      total++;
      var s = (plot.status || "").toLowerCase();
      if (s === "booked") booked++;
      else if (s === "available") available++;
      else if (s === "reserved") reserved++;
      else if (s === "registration done") bookedRegistered++;
    });

    document.getElementById("stat-total").textContent = total;
    document.getElementById("stat-booked").textContent = booked;
    document.getElementById("stat-available").textContent = available;
    document.getElementById("stat-reserved").textContent = reserved;
    document.getElementById("stat-booked-registered").textContent =
      bookedRegistered;
  }



    // ═══ ABOUT US MODAL ═══
(function () {
  const overlay   = document.getElementById('about-modal');
  const btnOpen   = document.getElementById('btn-about-us');
  const btnClose  = document.getElementById('about-close');
 
  if (!overlay || !btnOpen || !btnClose) return;
 
  btnOpen.addEventListener('click', () => overlay.classList.add('active'));
  btnClose.addEventListener('click', () => overlay.classList.remove('active'));
 
  // Close on backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('active');
  });
 
  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') overlay.classList.remove('active');
  });
})();
 
})();
