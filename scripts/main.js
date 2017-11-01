/*global $, ARS, document, moment, Promise, window */

var ARS;
ARS = ARS || {};
ARS.Controllers = ARS.Controllers || {};
ARS.Controllers.IndexController = (function () {
    "use strict";
    /*jslint unparam: true */

    function IndexController(context) {
        this.getContext = function () {
            return context;
        };

        this.attach();
    }

    IndexController.prototype.attach = function () {
        var context, events;
        context = this.getContext();

        events = {};
        events.changeAllUsers        = this.onChangeAllUsers.bind(this);
        events.changeTechnician      = this.onChangeTechnician.bind(this);
        events.changeRegion          = this.onChangeRegion.bind(this);
        events.changeTicket          = this.onChangeTicket.bind(this);
        events.changeWorkOrderFilter = this.onChangeWorkOrderFilter.bind(this);
        $(context.searchFilterFactory).on(events);

        events = {};
        events.changeWorkOrder  = this.onChangeWorkOrder.bind(this);
        events.sortByTechnician = this.onSortByTechnician.bind(this);
        events.sortByWorkOrder  = this.onSortByWorkOrder.bind(this);
        events.dragStart        = this.onInteractionStart.bind(this);
        events.dragStop         = this.onInteractionStop.bind(this);
        $(context.workOrderView).on(events);

        events = {};
        events.dropAppointment   = this.onDropAppointment.bind(this);
        events.updateAppointment = this.onUpdateAppointment.bind(this);
        events.removeAppointment = this.onRemoveAppointment.bind(this);
        events.selectTime        = this.onSelectTime.bind(this);
        events.renderCalendar    = this.onRenderCalendar.bind(this);
        events.interactionStart  = this.onInteractionStart.bind(this);
        events.interactionStop   = this.onInteractionStop.bind(this);
        events.toggleCompleted   = this.onToggleCompleted.bind(this);
        events.clickUrl 		 = this.onClickUrl.bind(this);
        $(context.calendarView).on(events);

        events = {};
        events.heartbeat = this.onHeartbeat.bind(this);
        $(context.heartbeatService).on(events);

        /* Turned of debounce because it was causing issues with the work order list:
        Whenever I reach the end of the list, it activates the debounce function,
        causing the work order list to be repopulated - the problem is that it adds
        double entries of the same work orders. Haven't test on a large scale so I'm
        not sure if turning this off will make a huge performance impact. */

        /*
        events = {};
        events.scroll = this.onScrollWorkOrders.bind(this).debounce(500);
        $("#workOrders").on(events);
        */
    };

    IndexController.prototype.onHeartbeat = function () {
        var context = this.getContext();

        // This is supposed to avoid bothering the user.  To that end,
        // there is no busy animation, and we skip zooming the map around.

        context.heartbeatService.stop();
        context.updateAppointmentsAsync().then(function () {
            context.heartbeatService.start();
        });
    };

    IndexController.prototype.onInteractionStart = function () {
        this.getContext().heartbeatService.stop();
    };

    IndexController.prototype.onInteractionStop = function () {
        this.getContext().heartbeatService.start();
    };

    IndexController.prototype.onRenderCalendar = function () {
        var context = this.getContext();

        context.animationService.showBusyAnimation();
        context.heartbeatService.stop();

        return context.updateAppointmentsAsync().then(function () {
            context.mapView.zoomToPins();
            context.heartbeatService.start();
        }).finally(context.animationService.hideBusyAnimation);
    };

    IndexController.prototype.onSelectTime = function () {
        var context = this.getContext();

        context.animationService.showBusyAnimation();
        return context
            .loadWorkOrdersAndDistancesAsync()
            .finally(context.animationService.hideBusyAnimation);
    };

    IndexController.prototype.onUpdateAppointment =
        function (ignore, appointment, startDate, endDate, timeZone) {
            var context, tasks, times, userZone;

            context  = this.getContext();
            times    = context.timeService;
            userZone = context.userTimeZone;

            context.animationService.showBusyAnimation();
            context.heartbeatService.stop();

            tasks    = [];
            tasks[0] = times.convertTimeZone(startDate, timeZone, userZone);
            tasks[1] = times.convertTimeZone(endDate, timeZone, userZone);

            Promise.all(tasks).then(function (results) {
                var id, userStart, userEnd;
                id        = appointment.appointmentId;
                userStart = results[0];
                userEnd   = results[1];

                return context.serviceAppointmentService
                    .updateServiceAppointmentAsync(id, userStart, userEnd);
            }).then(function () {
                return context.updateAppointmentsAsync();
            }).then(function () {
                context.mapView.zoomToPins();
                context.heartbeatService.start();
            }).finally(context.animationService.hideBusyAnimation);
        };

    IndexController.prototype.onRemoveAppointment =
        function (ignore, appointment) {
            var context = this.getContext();

            context.animationService.showBusyAnimation();
            context.heartbeatService.stop();

            function unassign() {
                return context.workOrderService
                    .unassignWorkOrder(appointment.workOrder);
            }

            context.serviceAppointmentService
                .deleteServiceAppointmentAsync(appointment.appointmentId)
                .then(unassign)
                .then(function () {
                    var nextSteps = [];
                    nextSteps[0]  = context.updateWorkOrdersAsync();
                    nextSteps[1]  = context.updateAppointmentsAsync();
                    return Promise.all(nextSteps);
                })
                .then(function () {
                    context.mapView.zoomToPins();
                    context.heartbeatService.start();
                })
                .finally(context.animationService.hideBusyAnimation);
        };

    IndexController.prototype.onDropAppointment =
        function (ev, workOrder, startDate, timeZone) {
            var context, tech, msg;

            context = this.getContext();
            tech    = context.searchFilterFactory.selectedTechnicians;

            if (tech.length !== 1) {
                msg =
                    "Please select exactly one technician before dropping " +
                    "a work order on the calendar.";

                context.notificationService.showNotification(msg);
                ev.preventDefault();
                return Promise.reject(msg);
            }

            tech = tech[0];

            context.animationService.showBusyAnimation();
            context.heartbeatService.stop();
            return context
                .addAppointmentAsync(tech, workOrder, startDate, timeZone)
                .then(function () {
                    context.mapView.zoomToPins();
                    context.heartbeatService.start();
                })
                .finally(context.animationService.hideBusyAnimation);
        };

    IndexController.prototype.onToggleCompleted =
        function (ignore, workOrder) {
            var context;

            context = this.getContext();

            context.animationService.showBusyAnimation();
            context.heartbeatService.stop();
            context
                .toggleCompleted(workOrder)
                .then(function () {
                    var tasks = [];
                    tasks[0]  = context.updateWorkOrdersAsync();
                    tasks[1]  = context.updateAppointmentsAsync();
                    return Promise.all(tasks);
                })
                .then(function () {
                    context.mapView.zoomToPins();
                    context.heartbeatService.start();
                })
                .finally(context.animationService.hideBusyAnimation);
        };


    IndexController.prototype.onClickUrl = function (ignore, workOrder) {
        var context;

        context = this.getContext();
    };

    IndexController.prototype.onScrollWorkOrders = function () {
        var container, context, scrollHeight, top, totalHeight;

        context      = this.getContext();
        container    = $("#workOrders");
        top          = container.scrollTop();
        totalHeight  = container.innerHeight();
        scrollHeight = container.prop("scrollHeight");

        if (top + totalHeight >= scrollHeight) {
            context.animationService.showBusyAnimation();

            context
                .loadMoreWorkOrdersAsync()
                .then(context.mapView.zoomToPins.bind(context.mapView))
                .finally(context.animationService.hideBusyAnimation);
        }
    };

    IndexController.prototype.onSortByWorkOrder = function () {
        /// <summary>
        /// Sort technicians by proximity to selected work order.
        /// </summary>

        var context, message, workOrder;
        context   = this.getContext();
        workOrder = context.workOrderView.getSelectedWorkOrder();

        if (!workOrder) {
            message = "Please select a work order.";
            context.notificationService.showNotification(message);
            return;
        }

        if (workOrder.latLng instanceof ARS.Models.LatLng === false) {
            message = "The selected work order has an invalid address.";
            context.notificationService.showNotification(message);
            return;
        }

        context.animationService.showBusyAnimation();
        context
            .sortTechniciansByDistanceToWorkOrderAsync(workOrder)
            .finally(context.animationService.hideBusyAnimation);
    };

    IndexController.prototype.onSortByTechnician = function () {
        /// <summary>
        /// Sort work orders by proximity to the selected technician.
        /// </summary>

        var context = this.getContext();

        context.animationService.showBusyAnimation();

        context.loadWorkOrdersAndDistancesAsync()
            .then(function (withDistances) {
                context.clearWorkOrders();
                context.addWorkOrders(withDistances);
            })
            .finally(context.animationService.hideBusyAnimation);
    };

    IndexController.prototype.onChangeWorkOrderFilter = function () {
        var context = this.getContext();

        context.animationService.showBusyAnimation();

        context
            .updateWorkOrdersAsync()
            .then(context.mapView.zoomToPins.bind(context.mapView))
            .finally(context.animationService.hideBusyAnimation);
    };

    IndexController.prototype.onChangeTicket =
        IndexController.prototype.onChangeWorkOrderFilter;

    IndexController.prototype.onChangeAllUsers =
        IndexController.prototype.onChangeWorkOrderFilter;

    IndexController.prototype.onChangeRegion = function () {
        var context, tasks;

        context = this.getContext();
        tasks   = [];

        context.animationService.showBusyAnimation();
        context.heartbeatService.stop();
        tasks.push(context.updateTechniciansAsync());
        tasks.push(context.updateWorkOrdersAsync());

        Promise.all(tasks).then(function () {
            context.mapView.zoomToPins();
            context.heartbeatService.start();
        }).finally(context.animationService.hideBusyAnimation);
    };

    IndexController.prototype.onChangeTechnician = function () {
        var context, techs;

        context = this.getContext();
        techs = context.searchFilterFactory.selectedTechnicians;
        context.workOrderView.clearDistances();

        if (techs.length === 0) {
            context.mapView.clearTechnicians();
            context.calendarView.technicians = techs;
            context.clearAppointments();
            context.mapView.zoomToPins();
            $("[data-action='sort-by-technician']").prop("disabled", true);
            return;
        }

        context.animationService.showBusyAnimation();
        context.heartbeatService.stop();

        context.mapView.clearTechnicians();
        context.mapView.addTechnicians(techs);
        context.calendarView.technicians = techs;

        context.updateAppointmentsAsync().then(function () {
            context.mapView.zoomToPins();
            context.heartbeatService.start();
            $("[data-action='sort-by-technician']")
                .prop("disabled", techs.length !== 1);
        }).finally(context.animationService.hideBusyAnimation);
    };

    IndexController.prototype.onChangeWorkOrder = function () {
        var context, workOrder;
        context = this.getContext();
        workOrder = context.workOrderView.getSelectedWorkOrder();
        context.updateWorkOrderDetail();
        context.mapView.selectWorkOrder(workOrder);
    };

    return IndexController;
}());

/*global $, document, window */

var ARS;
ARS = window.ARS || {};
ARS.Controls = ARS.Controls || {};
ARS.Controls.TimeZoneDropdown = (function () {
    "use strict";

    function Behavior(control) {
        this.onChange = function (ev) {
            var bubble = new $.Event(ev, { type: "change" });
            $(control).triggerHandler(bubble);
        };

        this.attach = function () {
            control.dom.element.on("change", this.onChange);
        };
    }

    function Dom() {
        Object.defineProperties(this, {
            element: {
                value: $("<select class=\"timeZoneSelect\" />")
            },
            supportedTimeZones: {
                value: $("<optgroup label=\"United States\" />")
            },
            techTimeZones: {
                value: $("<optgroup label=\"Technician Time Zone\" />")
            },
            userTimeZone: {
                value: $("<optgroup label=\"Dispatch Time Zone\" />")
            }
        });

        this.element.append(this.userTimeZone);
        this.element.append(this.techTimeZones);
        this.element.append(this.supportedTimeZones);
    }

    Object.defineProperties(Dom.prototype, {
        selected: {
            get: function () {
                var idx, opt;
                idx = this.element.prop("selectedIndex");
                opt = this.element.find("option")[idx];
                return opt ? String(opt.value || "").trim() : "";
            }
        }
    });

    Dom.prototype.renderTimeZone = function (timeZone) {
        var opt = document.createElement("option");
        opt.text = timeZone.userInterfaceName;
        opt.value = timeZone.standardName;
        return opt;
    };

    function TimeZoneDropdown() {
        var instance                 = {};
        instance.userTimeZone        = null;
        instance.supportedTimeZones  = [];
        instance.technicianTimeZones = [];

        Object.defineProperties(this, {
            behavior: { value: new Behavior(this) },
            dom:      { value: new Dom()          },
            supportedTimeZones: {
                get: function () {
                    return instance.supportedTimeZones.slice(0);
                }
            },
            technicianTimeZones: {
                get: function () {
                    return instance.technicianTimeZones.slice(0);
                }
            },
            userTimeZone: {
                get: function () {
                    return instance.userTimeZone;
                },
                set: function (value) {
                    value =
                        value instanceof ARS.Models.TimeZone ? value : null;

                    if (value === null) {
                        if (instance.userTimeZone !== null) {
                            this.dom.userTimeZone.empty();
                            instance.userTimeZone = null;
                        }
                    } else if (value.equals(instance.userTimeZone) === false) {
                        this.dom.userTimeZone
                            .empty()
                            .append(this.dom.renderTimeZone(value));

                        instance.userTimeZone = value;
                    }
                }
            }
        });

        this.addSupportedTimeZone = function (timeZone) {
            if (timeZone instanceof ARS.Models.TimeZone === false) {
                throw new TypeError("Expecting ARS.Models.TimeZone.");
            }

            if (instance.supportedTimeZones.first(timeZone.equals, timeZone)) {
                return;
            }

            instance.supportedTimeZones.push(timeZone);

            this.dom.supportedTimeZones
                .append(this.dom.renderTimeZone(timeZone));
        };

        this.behavior.attach();
    }

    Object.defineProperties(TimeZoneDropdown.prototype, {
        selectedTimeZone: {
            get: function () {
                var value = this.dom.selected;

                return this.timeZones.first(function (tz) {
                    return tz.standardName === value;
                }) || null;
            }
        },
        timeZones: {
            get: function () {
                return this.supportedTimeZones
                    .concat(this.technicianTimeZones)
                    .concat([ this.userTimeZone ])
                    .filter(Boolean)
                    .distinct(function (a, b) {
                        return a.equals(b);
                    });
            }
        }
    });

    TimeZoneDropdown.prototype.prependTo = function (target) {
        this.dom.element.prependTo(target);
    };

    TimeZoneDropdown.prototype.updateTechnicianTimeZones = function (techs) {
        var current, options, selected;

        current = this.dom.element.find("option:selected").text();
        this.dom.techTimeZones.empty();

        techs = techs || [];

        options = techs.filter(function (tech) {
            return tech && tech.timeZone && tech.timeZone.standardName;
        }).distinct(function (a, b) {
            return a.equals(b);
        }).sort(function (a, b) {
            var x, y;
            x = String(a.name || "").toLowerCase();
            y = String(b.name || "").toLowerCase();
            return x > y ? 1 : x < y ? -1 : 0;
        }).map(function (tech) {
            var isSelected, text, value, option;
            text         = tech.name + " - " + tech.timeZone.userInterfaceName;
            value        = tech.timeZone.standardName;
            isSelected   = text === current;
            option       = document.createElement("option");
            option.text  = text;
            option.value = value;
            return { option: option, selected: isSelected };
        });

        options.forEach(function (o) {
            this.dom.techTimeZones.append(o.option);
        }, this);

        selected = options.first(function (o) {
            return o.selected ? o.option : null;
        });

        if (selected) {
            selected = this.dom.element.find("option").index(selected);

            if (selected !== -1) {
                this.dom.element.prop("selectedIndex", selected);
            }
        }
    };

    return TimeZoneDropdown;
}());

/*global ARS, Promise, SDK */

var ARS;
ARS = ARS || {};
ARS.DataRepository = (function () {
    "use strict";

    function DataRepository() {
        return undefined;
    }

    DataRepository.prototype.createRecordAsync = function (object, type) {
        return new Promise(function (resolve, reject) {
            return Promise.attempt(function () {
                SDK.JQuery.createRecord(object, type, resolve, reject);
            });
        });
    };

    DataRepository.prototype.loadMultipleRecordsAsync =
        function (type, options) {
            return new Promise(function (resolve, reject) {
                return Promise.attempt(function() {
                    var result = [];

                    function success(records) {
                        result = records.concat(result);
                    }

                    function onComplete() {
                        resolve(result);
                    }

                    SDK.JQuery.retrieveMultipleRecords(
                        type,
                        options,
                        success,
                        reject,
                        onComplete
                    );
                });
            });
        };

    DataRepository.prototype.deleteRecordAsync = function (id, type) {
        return new Promise(function (resolve, reject) {
            return Promise.attempt(function () {
                SDK.JQuery.deleteRecord(id, type, resolve, reject);
            });
        });
    };

    DataRepository.prototype.updateRecordAsync = function (id, object, type) {
        return new Promise(function(resolve, reject) {
            return Promise.attempt(function() {
                SDK.JQuery.updateRecord(id, object, type, resolve, reject);
            });
        });
    };

    DataRepository.prototype.getOptionsAsync =
        function (entityName, optionSetAttributeName) {

            function hasLabel(option) {
                return option.OptionMetadata && option.OptionMetadata.Label;
            }

            function mapViewModel(option) {
                var m = {};
                m.label = option.OptionMetadata.Label.UserLocalizedLabel.Label;
                m.value = option.OptionMetadata.Value;
                return m;
            }

            return new Promise(function (resolve, reject) {

                var entityLogicalName, logicalName;

                function success(attributeMetadata) {
                    var hasValue, options;

                    hasValue =
                        attributeMetadata &&
                        attributeMetadata.OptionSet &&
                        attributeMetadata.OptionSet.Options;

                    if (!hasValue) {
                        resolve([]);
                        return;
                    }

                    options = attributeMetadata.OptionSet.Options
                        .filter(hasLabel)
                        .map(mapViewModel);

                    resolve(options);
                }

                entityLogicalName     = entityName.toLowerCase();
                logicalName           = optionSetAttributeName.toLowerCase();

                SDK.MetaData.RetrieveAttributeAsync(
                    entityLogicalName,
                    logicalName,
                    null, // metadataId
                    false, // retrieveAsIfPublished
                    success,
                    reject
                );
            });
        };

    return DataRepository;
}());

/*global ARS, Promise */

var ARS;
ARS = ARS || {};
ARS.Fakes = ARS.Fakes || {};
ARS.Fakes.FakeDataRepository = (function () {
    "use strict";

    var bingMapsKey;

    bingMapsKey =
        "AuEtawEchNJulYYGvBSox23IKjKh2ZWoA5QHI-V4Leh5gmSfHygoM1S8GENc-7Zv";

    function resolveSetting(options) {
        var result;

        if (options.indexOf("ars_name eq 'Bing Maps Key'") !== -1) {
            result = {};
            result.ars_Value = bingMapsKey;
            result = [ result ];

            return Promise.resolve(result);
        }

        result = "Unknown setting: " + options;
        return Promise.reject(result);
    }

    function FakeDataRepository() {
        return undefined;
    }

    FakeDataRepository.prototype.loadMultipleRecordsAsync =
        function (type, options) {
            var msg, parts;

            if (type === "ars_arssetting") {
                return resolveSetting(options);
            }

            parts         = {};
            parts.type    = type;
            parts.options = options;

            msg =
                "Fake has not been yet provided for entity '{type}' and " +
                "following options '{options}'";

            msg = msg.supplant(parts);
            return Promise.reject(msg);
        };

    return FakeDataRepository;
}());

/*global ARS, Promise */

var ARS;
ARS = ARS || {};
ARS.Fakes = ARS.Fakes || {};
ARS.Fakes.FakeRegionService = (function () {
    "use strict";

    var regions = [{
        id:   "e9becb12-212a-47fd-8b32-d80f8f40f2d2",
        name: "Alaska"
    }, {
        id:   "85d23a06-ca4c-41ba-8659-dc7b63a0b543",
        name: "Alabama"
    }, {
        id:   "9d376648-d624-4df5-a183-055c77267154",
        name: "California"
    }, {
        id:   "29dfbda4-1fbf-46ba-88d3-037a002d6556",
        name: "Georgia"
    }, {
        id:   "3085b4f2-5c29-4a2d-ba6c-a3d931bf549f",
        name: "Kansas"
    }, {
        id:   "10884b31-484e-434b-8543-65128050931f",
        name: "New York"
    }, {
        id:   "59d979cd-19e4-4b8b-80c0-0eced58b6d81",
        name: "Texas"
    }, {
        id:   "12b9c7ca-561a-4b13-ab2b-1745d60943c9",
        name: "Idaho"
    }, {
        id:   "1b54a5c9-4c6e-48ad-8a6d-0308da3d1790",
        name: "Utah"
    }, {
        id:   "37c7d594-be19-401e-9041-816f5add70da",
        name: "Florida"
    }, {
        id:   "3dc0c060-9620-4d61-9335-ee01ccfdca4e",
        name: "South Dakota"
    }];

    function mapViewModel(entity) {
        var viewModel = {};
        viewModel.regionId = entity.id;
        viewModel.name     = entity.name;
        return viewModel;
    }

    function FakeRegionService() {
        return undefined;
    }

    FakeRegionService.prototype.getRegionsAsync = function () {
        return Promise.resolve(regions.map(mapViewModel));
    };

    return FakeRegionService;
}());

/*global ARS, Promise, moment */
/*jslint bitwise: true */

var ARS;
ARS = ARS || {};
ARS.Fakes = ARS.Fakes || {};
ARS.Fakes.FakeServiceAppointmentService = (function () {
    "use strict";

    function createGuid() {
        var template;
        template = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
        return template.replace(/[xy]/g, function (c) {
            var r, v;
            r = Math.random() * 16 | 0;
            v = c === "x" ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    function extractTechIds(filters) {
        var techFilter;

        filters = filters || [];

        techFilter = filters.first(function (filter) {
            return filter instanceof ARS.Filters.TechnicianFilter;
        });

        return techFilter ?
                techFilter.selectedTechnicians.pluck("technicianId") :
                "";
    }

    function mapDateTime(userDateTime) {
        return moment(userDateTime).utc().format("YYYY-MM-DD[T]HH:mm:ss[Z]");
    }

    function mapToModel(appointment) {
        if (!appointment) {
            return null;
        }

        var model, tech, workOrder;

        tech = appointment.technician;
        tech = ARS.Fakes.FakeTechnicianService.getById(tech);

        workOrder = appointment.incident;
        workOrder = ARS.Fakes.FakeWorkOrderService.getById(workOrder);

        model               = new ARS.Models.ServiceAppointment();
        model.technician    = tech;
        model.appointmentId = appointment.appointmentId;
        model.utcEnd        = mapDateTime(appointment.end);
        model.utcStart      = mapDateTime(appointment.start);
        model.workOrder     = workOrder;
        return model;
    }

    function DateRange(start, end) {
        this.start = start;
        this.end   = end;
    }

    DateRange.prototype.intersects = function (other) {
        if (this.end.isBefore(other.start)) {
            return false;
        }

        if (this.start.isAfter(other.end)) {
            return false;
        }

        return true;
    };

    DateRange.prototype.toString = function () {
        // for debugging
        return this.start.format() + " - " + this.end.format();
    };

    DateRange.fromFilters = function (filters) {
        var end, start;

        filters = filters || [];

        filters = filters.first(function (filter) {
            return filter instanceof ARS.Filters.DateRangeFilter;
        });

        start = moment.utc(filters.start);
        end   = moment.utc(filters.end);

        return new DateRange(start, end);
    };

    DateRange.fromAppointment = function (appointment) {
        var end, start;

        start = moment(appointment.start);
        end   = moment(appointment.end);
        return new DateRange(start, end);
    };

    function FakeServiceAppointmentService(technicianService) {
        if (!technicianService) {
            throw new Error("Missing parameter: technicianService");
        }

        this.technicianService = technicianService;
        this.appointments = [];
    }

    FakeServiceAppointmentService.prototype.getServiceAppointmentsAsync =
        function (filters) {
            var filterRange, techIds, results;

            techIds = extractTechIds(filters);
            filterRange = DateRange.fromFilters(filters);

            results = this.appointments.filter(function (appointment) {
                var range = DateRange.fromAppointment(appointment);

                if (filterRange.intersects(range) === false) {
                    return false;
                }

                return techIds.length === 0 ||
                    techIds.indexOf(appointment.technician) !== -1;
            }).map(mapToModel);

            return Promise.resolve(results);
        };

    FakeServiceAppointmentService.prototype.createServiceAppointmentAsync =
        function (workOrder, technician, userStart, userEnd) {
            if (!workOrder) {
                throw new Error("Missing parameter: workOrder");
            }

            if (!technician) {
                throw new Error("Missing parameter: technician");
            }

            if (!userStart) {
                throw new Error("Missing parameter: userStart");
            }

            if (!userEnd) {
                throw new Error("Missing parameter: userEnd");
            }

            userStart = moment(userStart).format("YYYY-MM-DD[T]HH:mm:ss");
            userEnd   = moment(userEnd).format("YYYY-MM-DD[T]HH:mm:ss");

            var appointment           = {};
            appointment.appointmentId = createGuid();
            appointment.technician    = technician.technicianId;
            appointment.incident      = workOrder.workOrderId;
            appointment.start         = userStart;
            appointment.end           = userEnd;

            this.appointments.push(appointment);
            return Promise.resolve(mapToModel(appointment));
        };

    FakeServiceAppointmentService.prototype.updateServiceAppointmentAsync =
        function (appointmentId, userStart, userEnd) {

            userStart = userStart ?
                moment(userStart).format("YYYY-MM-DD[T]HH:mm:ss") : null;

            userEnd = userEnd ?
                moment(userEnd).format("YYYY-MM-DD[T]HH:mm:ss") : null;

            this.appointments.filter(function (appointment) {
                return appointment.appointmentId === appointmentId;
            }).forEach(function (appointment) {

                if (userStart) {
                    appointment.start = userStart;
                }

                if (userEnd) {
                    appointment.end = userEnd;
                }
            });

            return Promise.resolve();
        };

    FakeServiceAppointmentService.prototype.deleteServiceAppointmentAsync =
        function (appointmentId) {
            this.appointments = this.appointments.filter(function (a) {
                return a.appointmentId !== appointmentId;
            });

            return Promise.resolve();
        };

    FakeServiceAppointmentService.prototype.getTechnicianCoordinatesAsync =
        function (tech) {
            var result              = {};
            result.addressComposite = tech.addressComposite;
            result.latLng           = tech.latLng;

            return Promise.resolve(result);
        };

    FakeServiceAppointmentService.prototype.getTechnicianDistanceAsync =
        function (tech, utcTime, to) {
            if (to instanceof ARS.Models.LatLng === false) {
                throw new TypeError("Expecting ARS.Models.LatLng");
            }

            return this
                .getTechnicianCoordinatesAsync(tech, utcTime)
                .then(function (location) {
                    var from = location ? location.latLng : null;

                    return from instanceof ARS.Models.LatLng ?
                            from.getDistanceInMiles(to) :
                            Infinity; // I can see the universe.
                });
        };

    return FakeServiceAppointmentService;
}());

/*global $, ARS, Promise */

var ARS;
ARS = ARS || {};
ARS.Fakes = ARS.Fakes || {};
ARS.Fakes.FakeTechnicianService = (function () {
    "use strict";

    var technicians = [
        {
            id:               "8bc94374-5203-4e78-a5bb-2e9201bf4b07",
            name:             "Donald Trump", // ha ha, it's a joke.
            regionId:         "e9becb12-212a-47fd-8b32-d80f8f40f2d2",
            timeZone:         "Eastern Standard Time"
        }, {
            id:               "e9becb12-212a-47fd-8b32-d80f8f40f2d4",
            name:             "George Washington",
            regionId:         "e9becb12-212a-47fd-8b32-d80f8f40f2d2",
            city:             "Mount Vernon",
            state:            "Virginia",
            timeZone:         "Eastern Standard Time",
            latitude:         38.735278,
            longitude:        -77.095278
        }, {
            id:               "85d23a06-ca4c-41ba-8659-dc7b63a0b54e",
            name:             "John Adams",
            regionId:         "9d376648-d624-4df5-a183-055c77267154",
            timeZone:         "Eastern Standard Time",
            city:             "Quincy",
            state:            "Massachusetts",
            latitude:         42.25,
            longitude:        -71
        }, {
            id:               "9d376648-d624-4df5-a183-055c77267159",
            name:             "Thomas Jefferson",
            regionId:         "e9becb12-212a-47fd-8b32-d80f8f40f2d2",
            timeZone:         "Eastern Standard Time",
            city:             "Charlottesville",
            state:            "Virginia",
            latitude:         38.03,
            longitude:        -78.478889
        }, {
            id:               "29dfbda4-ffbf-46ba-88d3-037a002d6556",
            name:             "James Madison",
            regionId:         "e9becb12-212a-47fd-8b32-d80f8f40f2d2",
            timeZone:         "Eastern Standard Time",
            city:             "Orange",
            state:            "Virginia",
            latitude:         38.245833,
            longitude:        -78.109722
        }, {
            id:               "83b4fed4-d509-47bd-97f0-8fe7fee8bc5a",
            name:             "James Monroe",
            regionId:         "9d376648-d624-4df5-a183-055c77267154",
            timeZone:         "Eastern Standard Time",
            city:             "Leesburg",
            state:            "Virginia",
            latitude:         39.116667,
            longitude:        -77.55
        }, {
            id:               "144fe0e0-2636-42b3-8607-a0fc45396672",
            name:             "John Quincy Adams",
            regionId:         "e9becb12-212a-47fd-8b32-d80f8f40f2d2",
            timeZone:         "Eastern Standard Time",
            city:             "Quincy",
            state:            "Massachusetts",
            latitude:         42.25,
            longitude:        -71
        }, {
            id:               "9c808a6a-1d88-46ca-9863-0ab10a729958",
            name:             "Andrew Jackson",
            regionId:         "e9becb12-212a-47fd-8b32-d80f8f40f2d2",
            timeZone:         "Central Standard Time",
            city:             "Nashville",
            state:            "Tennessee",
            latitude:         36.166667,
            longitude:        -86.783333
        }, {
            id:               "da971790-af92-4021-8786-b9a91d9cd3be",
            name:             "Martin Van Buren",
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            timeZone:         "Eastern Standard Time",
            city:             "Kinderhook",
            state:            "New York",
            latitude:         42.412778,
            longitude:        -73.681389
        }, {
            id:               "58d432e1-a28a-4a45-9c8a-74b705accd4a",
            name:             "William Henry Harrison",
            regionId:         "e9becb12-212a-47fd-8b32-d80f8f40f2d2",
            timeZone:         "Eastern Standard Time",
            city:             "Vincennes",
            state:            "Indiana",
            latitude:         38.678333,
            longitude:        -87.516111
        }, {
            id:               "53c1a536-9075-4ef8-b6f6-134d190f5c24",
            name:             "John Tyler",
            regionId:         "e9becb12-212a-47fd-8b32-d80f8f40f2d2",
            timeZone:         "Eastern Standard Time",
            city:             "Charles City County",
            state:            "Virginia",
            latitude:         null,
            longitude:        null
        }, {
            id:               "5f451850-8fa7-40ac-b5f2-cd4364a5ba8e",
            name:             "James K. Polk",
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            timeZone:         "Eastern Standard Time",
            city:             "Columbia",
            state:            "Tennessee",
            latitude:         35.615,
            longitude:        -87.044444
        }, {
            id:               "11b471e9-6f24-46e5-92a9-559ff5ec025b",
            name:             "Zachary Taylor",
            regionId:         "e9becb12-212a-47fd-8b32-d80f8f40f2d2",
            timeZone:         "Eastern Standard Time",
            city:             "Louisville",
            state:            "Kentucky",
            latitude:         38.25,
            longitude:        -85.766667
        }, {
            id:               "b9928990-3d53-4bad-a807-4f2473c1b761",
            name:             "Millard Fillmore",
            regionId:         "85d23a06-ca4c-41ba-8659-dc7b63a0b543",
            timeZone:         "Eastern Standard Time",
            city:             "East Aurora",
            state:            "New York",
            latitude:         42.766944,
            longitude:        -78.617222
        }, {
            id:               "858feb71-bec8-4854-b8f8-86d90cb01a00",
            name:             "Franklin Pierce",
            regionId:         "9d376648-d624-4df5-a183-055c77267154",
            timeZone:         "Eastern Standard Time",
            city:             "Concord",
            state:            "New Hampshire",
            latitude:         43.206667,
            longitude:        -71.538056
        }, {
            id:               "477d0500-b0f4-41dd-a13f-f15bf9936d14",
            name:             "James Buchanan",
            regionId:         "85d23a06-ca4c-41ba-8659-dc7b63a0b543",
            timeZone:         "Eastern Standard Time",
            city:             "Lancaster",
            state:            "Pennsylvania",
            latitude:         40.039722,
            longitude:        -76.304444
        }, {
            id:               "ffefac43-f31a-4183-8677-bed12fe91b62",
            name:             "Abraham Lincoln",
            regionId:         "e9becb12-212a-47fd-8b32-d80f8f40f2d2",
            timeZone:         "Central Standard Time",
            city:             "Springfield",
            state:            "Illinois",
            latitude:         39.698333,
            longitude:        -89.619722
        }, {
            id:               "5a155ba2-d72e-42b8-8570-bad78e79b18d",
            name:             "Andrew Johnson",
            regionId:         "9d376648-d624-4df5-a183-055c77267154",
            timeZone:         "Eastern Standard Time",
            city:             "Greeneville",
            state:            "Tennessee",
            latitude:         36.168333,
            longitude:        -82.8225
        }, {
            id:               "74149156-0793-43ee-9a09-b55228f964f0",
            name:             "Ulysses S. Grant",
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            timeZone:         "Central Standard Time",
            city:             "St. Louis",
            state:            "Missouri",
            latitude:         38.627222,
            longitude:        -90.197778
        }, {
            id:               "3d20d986-c7b7-4a04-9098-8294cdba9a9c",
            name:             "Rutherford B. Hayes",
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            timeZone:         "Eastern Standard Time",
            city:             "Fremont",
            state:            "Ohio",
            latitude:         41.348889,
            longitude:        -83.117222
        }, {
            id:               "19ddaa00-6979-4ad6-ba51-c088cd48492b",
            name:             "James A. Garfield",
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            timeZone:         "Eastern Standard Time",
            city:             "Mentor",
            state:            "Ohio",
            latitude:         41.691111,
            longitude:        -81.341944
        }, {
            id:               "35f673e5-fb44-43f1-af70-4255217ed123",
            name:             "Chester A. Arthur",
            regionId:         "85d23a06-ca4c-41ba-8659-dc7b63a0b543",
            timeZone:         "Eastern Standard Time",
            city:             "New York City",
            state:            "New York",
            latitude:         40.7127,
            longitude:        -74.0059
        }, {
            id:               "06f7df55-a5e3-4c89-91ff-928a82dd516d",
            name:             "Grover Cleveland",
            regionId:         "9d376648-d624-4df5-a183-055c77267154",
            timeZone:         "Eastern Standard Time",
            city:             "Princeton",
            state:            "New Jersey",
            latitude:         40.357115,
            longitude:        -74.670165
        }, {
            id:               "b59691e4-cd75-43ef-800c-0098b4aeab56",
            name:             "Benjamin Harrison",
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            timeZone:         "Eastern Standard Time",
            city:             "Indianapolis",
            state:            "Indiana",
            latitude:         39.766667,
            longitude:        -86.15
        }, {
            id:               "4964df95-5e3a-4d2d-8f49-9ec964db8367",
            name:             "Grover Cleveland",
            regionId:         "9d376648-d624-4df5-a183-055c77267154",
            timeZone:         "Eastern Standard Time",
            city:             "Princeton",
            state:            "New Jersey",
            latitude:         40.357115,
            longitude:        -74.670165
        }, {
            id:               "4733033f-e249-409f-a7d8-4e47a8def83d",
            name:             "William McKinley",
            regionId:         "9d376648-d624-4df5-a183-055c77267154",
            timeZone:         "Eastern Standard Time",
            city:             "Canton",
            state:            "Ohio",
            latitude:         40.805,
            longitude:        -81.375833
        }, {
            id:               "1e0e5646-38b5-49ed-aa6a-bb39fa076134",
            name:             "Theodore Roosevelt",
            regionId:         "e9becb12-212a-47fd-8b32-d80f8f40f2d2",
            timeZone:         "Eastern Standard Time",
            city:             "Oyster Bay",
            state:            "New York",
            latitude:         40.872444,
            longitude:        -73.530778
        }, {
            id:               "b8076b7c-5688-4859-aa46-2c11e57f9728",
            name:             "William Howard Taft",
            regionId:         "85d23a06-ca4c-41ba-8659-dc7b63a0b543",
            timeZone:         "Eastern Standard Time",
            city:             "Cincinnati",
            state:            "Ohio",
            latitude:         39.1,
            longitude:        -84.516667
        }, {
            id:               "bd1647d0-8a7b-406d-a96c-36395591e63b",
            name:             "Woodrow Wilson",
            regionId:         "85d23a06-ca4c-41ba-8659-dc7b63a0b543",
            timeZone:         "Eastern Standard Time",
            city:             "Princeton",
            state:            "New Jersey",
            latitude:         40.357115,
            longitude:        -74.670165
        }, {
            id:               "db54e116-82f6-4f27-96b8-ed047aaed2e0",
            name:             "Warren G. Harding",
            regionId:         "85d23a06-ca4c-41ba-8659-dc7b63a0b543",
            timeZone:         "Eastern Standard Time",
            city:             "Marion",
            state:            "Ohio",
            latitude:         40.586667,
            longitude:        -83.126389
        }, {
            id:               "567745c4-9431-499d-b0e1-8003529cb82b",
            name:             "Calvin Coolidge",
            regionId:         "e9becb12-212a-47fd-8b32-d80f8f40f2d2",
            timeZone:         "Eastern Standard Time",
            city:             "Northampton",
            state:            "Massachusetts",
            latitude:         42.333333,
            longitude:        -72.65
        }, {
            id:               "63619a75-3a03-4d4f-8716-7218c6b37551",
            name:             "Herbert Hoover",
            regionId:         "85d23a06-ca4c-41ba-8659-dc7b63a0b543",
            timeZone:         "Pacific Standard Time",
            city:             "Stanford",
            state:            "California",
            latitude:         37.4225,
            longitude:        -122.165278
        }, {
            id:               "8c53ebe7-13c7-4668-95cc-07284f5df98a",
            name:             "Franklin D. Roosevelt",
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            timeZone:         "Eastern Standard Time",
            city:             "Hyde Park",
            state:            "New York",
            latitude:         41.783333,
            longitude:        -73.9
        }, {
            id:               "2126816f-4431-4c9d-becc-e7eee564ca0e",
            name:             "Harry S. Truman",
            regionId:         "9d376648-d624-4df5-a183-055c77267154",
            timeZone:         "Central Standard Time",
            city:             "Kansas City",
            state:            "Missouri",
            latitude:         39.099722,
            longitude:        -94.578333
        }, {
            id:               "4a0c938e-8c43-4b8c-be48-2543074941e6",
            name:             "Dwight D. Eisenhower",
            regionId:         "85d23a06-ca4c-41ba-8659-dc7b63a0b543",
            timeZone:         "Eastern Standard Time",
            city:             "Gettysburg",
            state:            "Pennsylvania",
            latitude:         39.828333,
            longitude:        -77.232222
        }, {
            id:               "0cf696ab-2dcf-4457-8f74-30c113a3d641",
            name:             "John F. Kennedy",
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            timeZone:         "Eastern Standard Time",
            city:             "Hyannis",
            state:            "Massachusetts",
            latitude:         41.652778,
            longitude:        -70.283333
        }, {
            id:               "d86c5733-a890-44d1-bf64-943f6091091e",
            name:             "Lyndon B. Johnson",
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            timeZone:         "Eastern Standard Time",
            city:             "Washington",
            state:            "D.C.",
            latitude:         38.904722,
            longitude:        -77.016389
        }, {
            id:               "ff1184a3-d09b-43a0-ba9c-a1f0b48b9420",
            name:             "Richard Nixon",
            regionId:         "85d23a06-ca4c-41ba-8659-dc7b63a0b543",
            timeZone:         "Eastern Standard Time",
            city:             "Park Ridge",
            state:            "New Jersey",
            latitude:         41.036301,
            longitude:        -74.043561
        }, {
            id:               "62c0bf3f-524f-49cc-82e4-fd4f06af10a1",
            name:             "Gerald Ford",
            regionId:         "9d376648-d624-4df5-a183-055c77267154",
            timeZone:         "Pacific Standard Time",
            city:             "Rancho Mirage",
            state:            "California",
            latitude:         33.769167,
            longitude:        -116.421111
        }, {
            id:               "645f1f4b-4c85-4ef8-9675-491a91c885cb",
            name:             "Jimmy Carter",
            regionId:         "e9becb12-212a-47fd-8b32-d80f8f40f2d2",
            timeZone:         "Eastern Standard Time",
            city:             "Plains",
            state:            "Georgia",
            latitude:         32.033611,
            longitude:        -84.393333
        }, {
            id:               "7d652ae0-7b68-4758-920e-837d790e8a9a",
            name:             "Ronald Reagan",
            regionId:         "9d376648-d624-4df5-a183-055c77267154",
            timeZone:         "Pacific Standard Time",
            city:             "Santa Barbara",
            state:            "California",
            latitude:         34.425833,
            longitude:        -119.714167
        }, {
            id:               "5772cfe2-471d-4464-bdf7-2b2664d6ae9e",
            name:             "George H. W. Bush",
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            timeZone:         "Eastern Standard Time",
            city:             "Kennebunkport",
            state:            "Maine",
            latitude:         43.380833,
            longitude:        -70.451944
        }, {
            id:               "fbf69c5e-2213-4238-8f30-561f0ef11075",
            name:             "Bill Clinton",
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            timeZone:         "Eastern Standard Time",
            city:             "Georgetown",
            state:            "Washington, D.C.",
            latitude:         38.909444,
            longitude:        -77.065
        }, {
            id:               "a8d23b26-8808-47da-b2ce-292e6397e51a",
            name:             "George W. Bush",
            regionId:         "9d376648-d624-4df5-a183-055c77267154",
            timeZone:         "Central Standard Time",
            city:             "Crawford",
            state:            "Texas",
            latitude:         31.534444,
            longitude:        -97.443889
        }, {
            id:               "890a1c42-1271-4a48-a82b-3f1199efa871",
            name:             "Barack Obama",
            regionId:         "85d23a06-ca4c-41ba-8659-dc7b63a0b543",
            timeZone:         "Central Standard Time",
            city:             "Kenwood, Chicago",
            state:            "Illinois",
            latitude:         41.81,
            longitude:        -87.6
        }
    ];

    function toTz(entity) {
        var code, name, ui;

        if (!entity) {
            return null;
        }

        if (!entity.timeZone) {
            return null;
        }

        code = entity.timeZone.length + entity.timeZone.charCodeAt(0);
        name = entity.timeZone;
        ui   = entity.timeZone;
        return ARS.Models.TimeZone.getOrCreate(name, ui, code);
    }

    function toViewModel(entity) {
        var latLng, viewModel;

        latLng = ARS.Models.LatLng
            .tryCreate(entity.latitude, entity.longitude);

        viewModel = new ARS.Models.Technician();
        viewModel.technicianId = entity.id;
        viewModel.city         = entity.city;
        viewModel.state        = entity.state;
        viewModel.latLng       = latLng;
        viewModel.name         = entity.name;
        viewModel.timeZone     = toTz(entity);

        return viewModel;
    }

    function technicianMatchesRegion(regionFilter) {
        var selected;

        selected = regionFilter.getSelected().map(function (guid) {
            return guid.toLowerCase();
        });

        return function (technician) {
            var regionId = technician.regionId.toLowerCase();
            return selected.indexOf(regionId) !== -1;
        };
    }

    function FakeTechnicianService() {
        return undefined;
    }

    FakeTechnicianService.prototype.getTechniciansAsync = function (filters) {
        var hasRegion, result;

        hasRegion =
            $.isArray(filters) &&
            filters[0] instanceof ARS.Filters.RegionFilter;

        if (hasRegion === false) {
            result = technicians.map(toViewModel);
            return Promise.resolve(result);
        }

        result = filters[0];
        result = technicianMatchesRegion(result);
        result = technicians.filter(result);
        result = result.map(toViewModel);
        return Promise.resolve(result);
    };

    FakeTechnicianService.getById = function (technicianId) {
        var entity;

        entity = technicians.first(function (tech) {
            return tech.id === technicianId;
        });

        return entity ? toViewModel(entity) : null;
    };

    return FakeTechnicianService;
}());

/*global ARS, Promise, moment, window */

var ARS;
ARS = ARS || {};
ARS.Fakes = ARS.Fakes || {};
ARS.Fakes.FakeTimeService = (function () {
    "use strict";

    var knownZones, supportedZones;

    supportedZones = [
        {
            userInterfaceName: "(GMT-05:00) Eastern Time (US & Canada)",
            timeZoneCode: 35,
            standardName: "Eastern Standard Time",
            offset: -300,
            dstOffset: -240
        }, {
            userInterfaceName: "(GMT-06:00) Central Time (US & Canada)",
            timeZoneCode: 20,
            standardName: "Central Standard Time",
            offset: -360,
            dstOffset: -300
        }, {
            userInterfaceName: "(GMT-07:00) Arizona",
            timeZoneCode: 15,
            standardName: "US Mountain Standard Time",
            offset: -420,
            dstOffset: -420
        }, {
            userInterfaceName: "(GMT-07:00) Mountain Time (US & Canada)",
            timeZoneCode: 10,
            standardName: "Mountain Standard Time",
            offset: -420,
            dstOffset: -360
        }, {
            userInterfaceName: "(GMT-08:00) Pacific Time (US & Canada)",
            timeZoneCode: 4,
            standardName: "Pacific Standard Time",
            offset: -480,
            dstOffset: -420
        }
    ];

    knownZones = supportedZones.slice(0);
    knownZones.push({
        userInterfaceName: "(GMT-09:00) Alaska",
        timeZoneCode: 3,
        standardName: "Alaskan Standard Time",
        offset: -540,
        dstOffset: -480
    });

    function toTimeZone(zone) {
        var name, code, ui;
        name = zone.standardName;
        code = zone.timeZoneCode;
        ui   = zone.userInterfaceName;
        return ARS.Models.TimeZone.getOrCreate(name, ui, code);
    }

    function getOffset(date, tz) {
        var rawZone;

        rawZone = knownZones.first(function (z) {
            return z.timeZoneCode === tz.code;
        });

        if (!rawZone) {
            window.console.error("Cannot find offset.");
            return 0;
        }

        return moment(date).isDST() ?
            rawZone.dstOffset : rawZone.offset;
    }

    function FakeTimeService() {
        return undefined;
    }

    FakeTimeService.prototype.getCurrentUserTimeZoneAsync = function () {
        var model = toTimeZone(supportedZones[0]);
        return Promise.resolve(model);
    };

    FakeTimeService.prototype.getSupportedTimeZones = function () {
        return supportedZones.map(toTimeZone);
    };

    FakeTimeService.prototype.getSupportedTimeZonesAsync = function () {
        return Promise.resolve(this.getSupportedTimeZones());
    };

    FakeTimeService.prototype.localTimeFromUtcTime = function (date, tz) {
        var offset = getOffset(date, tz);

        date = moment.utc(date)
            .add(offset, "minutes")
            .format("YYYY-MM-DD[T]HH:mm:ss");

        return Promise.resolve(date);
    };

    FakeTimeService.prototype.utcTimeFromLocalTime = function (date, tz) {
        var offset = getOffset(date, tz);

        date = moment(date)
            .subtract(offset, "minutes")
            .format("YYYY-MM-DD[T]HH:mm:ss[Z]");

        return Promise.resolve(date);
    };

    FakeTimeService.prototype.setAppointmentTimeZones =
        function (appointments, timeZone) {
            return ARS.Services.TimeService.prototype.setAppointmentTimeZones
                .call(this, appointments, timeZone);
        };

    FakeTimeService.prototype.convertTimeZone = function (date, from, to) {
        return ARS.Services.TimeService.prototype.convertTimeZone
            .call(this, date, from, to);
    };

    // for faking things
    FakeTimeService.getTimeZones = function () {
        return knownZones.reduce(function (prev, next) {
            prev[next.standardName] = toTimeZone(next);
            return prev;
        }, {});
    };

    return FakeTimeService;
}());

/*global ARS, Promise, moment */

var ARS;
ARS = ARS || {};
ARS.Fakes = ARS.Fakes || {};
ARS.Fakes.FakeWorkOrderService = (function () {
    "use strict";
    /*jslint unparam: true */

    var arke, lorem, statusCodes, workOrders;

    function byWorkOrderId(id) {
        return function (item) {
            return item.id === id;
        };
    }

    arke = "3400 Peachtree Rd NE\r\nSuite 200\r\nAtlanta, GA 30326\r\nUSA";

    lorem = // Test very long work order names.
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do " +
        "eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut " +
        "enim ad minim veniam, quis nostrud exercitation ullamco laboris " +
        "nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor " +
        "in reprehenderit in voluptate velit esse cillum dolore eu fugiat " +
        "nulla pariatur. Excepteur sint occaecat cupidatat non proident, " +
        "sunt in culpa qui officia deserunt mollit anim id est laborum";

    statusCodes = [
    //Does this even run? Let's test it out.

        { label: "Pending",                             value:         2 },
        { label: "Accepted",                            value: 172860000 },
        { label: "Scheduled",                           value: 172860002 },
        { label: "In Progress",                         value:         1 },
        { label: "Technician Offsite",                  value: 172860003 },
        { label: "Work Complete",                       value: 172860004 },
        { label: "Recall",                              value: 172860001 },
        { label: "Return - Need for Parts",             value: 100000001 },
        { label: "Return - Need to Quote",              value: 100000002 },
        { label: "Need to Quote - Electrical",          value: 172860012 },
        { label: "Need to Quote - General",             value: 172860013 },
        { label: "Need to Quote - Plumbing",            value: 172860014 },
        { label: "Closed",                              value:         5 },
        { label: "Canceled",                            value:         6 },
        { label: "Merged",                              value:      2000 }
    ];

    workOrders = [
        {
            id:               "fc98a5e5-9ee9-e411-80cf-000d3a20df62",
            addressComposite: "4675 Highway 136 West\r\nTalking Rock 30175",
            completeByDate:   "2015-06-01",
            duration:         3,
            latitude:         34.507779,
            longitude:        -84.506602,
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            ticketNumber:     "WO-01022-L9F9C0",
            timeZone:         "Eastern Standard Time",
            title:            "Broken interior door handle"
        }, {
            id:               "27f7525e-a9c9-e411-9427-00155d03c107",
            addressComposite: "1350 Walton Way\r\nAugusta 30901",
            completeByDate:   "2015-06-01",
            duration:         8,
            latitude:         33.472469,
            longitude:        -81.979959,
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            ticketNumber:     "WO-01004-F2K7H1",
            timeZone:         "Eastern Standard Time",
            title:            "Cracked floor tiles"
        }, {
            id:               "1529fff6-48c4-e411-a4fc-00155d03c107",
            addressComposite: arke,
            completeByDate:   null,
            duration:         28,
            latitude:         33.849084,
            longitude:        -84.364832,
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            ticketNumber:     "WO-01001-K2K6T5",
            timeZone:         "Eastern Standard Time",
            title:            "Expand the Day to 28 Hours"
        }, {
            id:               "595ea483-49c4-e411-a4fc-00155d03c107",
            addressComposite: arke,
            completeByDate:   "2015-06-01",
            duration:         0.15,
            isEmergency:      true,
            latitude:         33.849084,
            longitude:        -84.364832,
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            ticketNumber:     "WO-01002-Y4T9N2",
            timeZone:         "Eastern Standard Time",
            title:            "Fix This Now!!"
        }, {
            id:               "564139b2-4ac4-e411-a4fc-00155d03c107",
            addressComposite: arke,
            completeByDate:   "2015-06-01",
            duration:         5.5,
            latitude:         33.849084,
            longitude:        -84.364832,
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            ticketNumber:     "WO-01003-Z7Q5C4",
            timeZone:         "Eastern Standard Time",
            title:            "Help - Roof Leaking!!"
        }, {
            id:               "6476ad1f-cdc1-e411-b4b6-00155d03c107",
            addressComposite: arke,
            completeByDate:   "2015-06-01",
            duration:         2.75,
            latitude:         33.849084,
            longitude:        -84.364832,
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            ticketNumber:     "CAS-01000-X8G0D6",
            timeZone:         "Eastern Standard Time",
            title:            "Leaking Sprinkler System"
        }, {
            id:               "d5ace6f6-bdc9-e411-bde7-00155d03c107",
            addressComposite: arke,
            completeByDate:   "2015-06-01",
            duration:         8,
            latitude:         33.849084,
            longitude:        -84.364832,
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            ticketNumber:     "WO-01005-F5Q6T3",
            timeZone:         "Eastern Standard Time",
            title:            "Need Technician - Wall Damage"
        }, {
            id:               "6216e6ac-bec9-e411-bde7-00155d03c107",
            addressComposite: null,
            completeByDate:   "2015-06-01",
            duration:         4,
            latitude:         null,
            longitude:        null,
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            ticketNumber:     "WO-01006-M2F4F6",
            timeZone:         "Eastern Standard Time",
            title:            "New Work Order Received For CRM:0001001"
        }, {
            id:               "7d1b943b-c6cc-e411-bde7-00155d03c107",
            addressComposite: "1350 Walton Way\r\nAugusta 30901",
            completeByDate:   "2015-06-01",
            duration:         4,
            latitude:         33.472469,
            longitude:        -81.979959,
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            ticketNumber:     "WO-01007-X3M5N1",
            timeZone:         "Eastern Standard Time",
            title:            "Receive Building Permit for #123 CRM:0001952"
        }, {
            id:               "345bc48b-d7cc-e411-bde7-00155d03c107",
            addressComposite: null,
            completeByDate:   "2015-06-01",
            duration:         3,
            latitude:         null,
            longitude:        null,
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            ticketNumber:     "WO-01008-C3Y0B1",
            timeZone:         "Eastern Standard Time",
            title:            "Review Proposed Site for #123 CRM:0001968"
        }, {
            id:               "c51259c5-6ccd-e411-bde7-00155d03c107",
            addressComposite: null,
            completeByDate:   "2015-06-01",
            duration:         3,
            latitude:         null,
            longitude:        null,
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            ticketNumber:     "WO-01009-D7K0Q0",
            timeZone:         "Eastern Standard Time",
            title:            "Review Proposed Site for #123 CRM:0001997"
        }, {
            id:               "f5b3d542-6ecd-e411-bde7-00155d03c107",
            addressComposite: null,
            completeByDate:   "2015-06-01",
            duration:         3,
            latitude:         null,
            longitude:        null,
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            ticketNumber:     "WO-01010-K3P6D3",
            timeZone:         "Eastern Standard Time",
            title:            "Test WO"
        }, {
            id:               "5b6fa0d0-69d1-e411-bde7-00155d03c107",
            addressComposite: null,
            completeByDate:   "2015-06-01",
            duration:         240,
            latitude:         null,
            longitude:        null,
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            ticketNumber:     "WO-01011-B6F4V4",
            timeZone:         "Eastern Standard Time",
            title:            "Initiative Failed So Spectacularly"
        }, {
            id:               "fb06049e-6bd1-e411-bde7-00155d03c107",
            addressComposite: arke,
            completeByDate:   "2015-06-01",
            duration:         4,
            latitude:         33.849084,
            longitude:        -84.364832,
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            ticketNumber:     "WO-01012-Y1J5M8",
            timeZone:         "Eastern Standard Time",
            title:            "Too Many Cats"
        }, {
            id:               "c49d5798-d1d1-e411-bde7-00155d03c107",
            addressComposite: null,
            completeByDate:   "2015-06-01",
            duration:         69,
            latitude:         null,
            longitude:        null,
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            ticketNumber:     "WO-01013-T5K3N5",
            timeZone:         "Eastern Standard Time",
            title:            "I Need an Adult"
        }, {
            id:               "9215d57a-d2d1-e411-bde7-00155d03c107",
            addressComposite: "90 Marietta Station Walk NE, Marietta",
            completeByDate:   "2015-06-01",
            duration:         1,
            latitude:         33.954605,
            longitude:        -84.551169,
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            ticketNumber:     "WO-01014-B3W9P3",
            timeZone:         "Eastern Standard Time",
            title:            "Something Is Wrong"
        }, {
            id:               "2e5d0c0a-d3d1-e411-bde7-00155d03c107",
            addressComposite: "4675 Highway 136 West\r\nTalking Rock 30175",
            completeByDate:   "2015-06-01",
            duration:         2,
            latitude:         34.507779,
            longitude:        -84.506602,
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            ticketNumber:     "WO-01015-T4K6T3",
            timeZone:         "Eastern Standard Time",
            title:            "Squirrels."
        }, {
            id:               "2942a685-d3d1-e411-bde7-00155d03c107",
            addressComposite: "339 W Church St\r\nJasper 30143",
            completeByDate:   "2015-06-01",
            duration:         null,
            latitude:         34.466377,
            longitude:        -84.433027,
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            ticketNumber:     "WO-01016-J1X7V1",
            timeZone:         "Eastern Standard Time",
            title:            "Lacking in Soul"
        }, {
            id:               "011fefbf-d3d1-e411-bde7-00155d03c107",
            addressComposite: "49 S Main St\r\nJasper 30143",
            completeByDate:   "2015-06-01",
            duration:         1.5,
            latitude:         34.467282,
            longitude:        -84.429536,
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            ticketNumber:     "WO-01017-Y5Y6C7",
            timeZone:         "Eastern Standard Time",
            title:            "I'm Hungry, Bring Me a Snack"
        }, {
            id:               "e4b50508-d4d1-e411-bde7-00155d03c107",
            addressComposite: "158 Church Street Southeast\r\nRanger 30734",
            completeByDate:   "2015-06-01",
            duration:         19,
            latitude:         34.499644,
            longitude:        -84.711723,
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            ticketNumber:     "WO-01018-N1P6N5",
            timeZone:         "Eastern Standard Time",
            title:            "Reality Is Thin"
        }, {
            id:               "1a8e7460-d4d1-e411-bde7-00155d03c107",
            addressComposite: "4675 Highway 136 West\r\nTalking Rock 30175",
            completeByDate:   "2015-06-01",
            duration:         Infinity,
            latitude:         34.507779,
            longitude:        -84.506602,
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            ticketNumber:     "WO-01019-Q6R9L9",
            timeZone:         "Eastern Standard Time",
            title:            lorem
        }, {
            id:               "4a99d0f6-d4d1-e411-bde7-00155d03c107",
            addressComposite: "339 W Church St\r\nJasper 30143",
            completeByDate:   "2015-06-01",
            duration:         3,
            latitude:         34.466377,
            longitude:        -84.433027,
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            ticketNumber:     "WO-01020-C9S9S1",
            timeZone:         "Eastern Standard Time",
            title:            "Need Some Trees Planted"
        }, {
            id:               "487867ce-05d3-e411-bde7-00155d03c107",
            addressComposite: null,
            completeByDate:   "2015-06-01",
            duration:         3,
            latitude:         null,
            longitude:        null,
            regionId:         "29dfbda4-1fbf-46ba-88d3-037a002d6556",
            ticketNumber:     "WO-01021-W2T8W2",
            timeZone:         "Eastern Standard Time",
            title:            "Pastry-Based Pareidolia"
        }, {
            id:               "8248fd17-7db4-4515-b6fb-1d9fe24479b8",
            addressComposite: "Juneau, Alaska",
            completeByDate:   "2015-08-24",
            duration:         3,
            latitude:         58.301944,
            longitude:        -134.419722,
            regionId:         "e9becb12-212a-47fd-8b32-d80f8f40f2d2",
            ticketNumber:     "WO-01024-W2T8W2",
            timeZone:         "Alaskan Standard Time",
            title:            "Return my library book"
        }, {
            id:               "4ba441ab-4f19-4db3-af7d-fac79d680708",
            addressComposite: "Barrow, Alaska",
            completeByDate:   null,
            duration:         3,
            latitude:         71.371438,
            longitude:        -156.449432,
            regionId:         "e9becb12-212a-47fd-8b32-d80f8f40f2d2",
            ticketNumber:     "WO-01025-W2T8W2",
            timeZone:         "Alaskan Standard Time",
            title:            "I'm cold.  Why am I so cold?"
        }
    ];

    function mapToModel(vm, timeZones) {
        var completeByDate, latLng, model;

        completeByDate =
            vm.completeByDate ? moment(vm.completeByDate).toDate() : null;

        latLng = ARS.Models.LatLng.tryCreate(vm.latitude, vm.longitude);

        model                    = new ARS.Models.WorkOrderModel();
        model.workOrderId        = vm.id;
        model.addressComposite   = vm.addressComposite;
        model.completeByDate     = completeByDate;
        model.isEmergency        = vm.isEmergency;
        model.latLng             = latLng;
        model.schedulingComplete = Boolean(vm.schedulingComplete);
        model.status             = vm.status || "Accepted";
        model.ticketNumber       = vm.ticketNumber;
        model.timeZone           = timeZones[vm.timeZone];
        model.title              = vm.title;
        model.description		 = vm.description;
        model.url 				 = vm.url;
        model.technician 		 = vm.technician;
        model.po				 = vm.po;
        return model;
    }

    function applyRegionFilter(list, regionFilter) {
        var selected = regionFilter.getSelected();

        return list.filter(function (wo) {
            return selected.indexOf(wo.regionId) !== -1;
        });
    }

    function applyWorkOrderFilter(list, workOrderFilter) {
        var codes, completed;
        completed = workOrderFilter.includeCompletedSchedules;
        codes = workOrderFilter.selectedCodes.map(function (value) {
            return statusCodes.filter(function (sc) {
                return sc.value === value;
            }).pluck("label").first() || null;
        });

        return list.filter(function (wo) {
            var code = wo.status || "Accepted";

            if (codes.indexOf(code) === -1) {
                return false;
            }

            if (completed === false) {
                if (wo.schedulingComplete === true) {
                    return false;
                }
            }

            return true;
        });
    }

    function applyFilters(filters) {
        filters = filters || [];

        return filters.reduce(function (list, filter) {
            if (filter instanceof ARS.Filters.RegionFilter) {
                return applyRegionFilter(list, filter);
            }

            if (filter instanceof ARS.Filters.WorkOrderFilter) {
                return applyWorkOrderFilter(list, filter);
            }

            // Could do all users and ticket filter here, if needed.
            return list;
        }, workOrders);
    }

    function FakeWorkOrderService() {
        return undefined;
    }

    FakeWorkOrderService.prototype.getWorkOrdersAsync =
        function (filters, paging) {
            var filtered, hasMore, page, perPage, result, skip,
                take, timeZones;

            paging    = paging || {};
            page      = paging.page || 1;
            perPage   = 20;
            skip      = (page - 1) * perPage;
            take      = page * perPage;
            filtered  = applyFilters(filters);
            result    = filtered.slice(skip, take);
            timeZones = ARS.Fakes.FakeTimeService.getTimeZones();
            hasMore   =
                result.length === perPage &&
                result[perPage - 1] !== filtered[filtered.length - 1];


            result = result.map(function (entity) {
                return mapToModel(entity, timeZones);
            });

            return Promise.resolve({
                workOrders: result,
                pagingCookie: "whatever",
                moreRecords: hasMore
            });
        };

    FakeWorkOrderService.prototype.getStatusCodesAsync = function () {
        return Promise.resolve(statusCodes.slice(0));
    };

    function setStatus(workOrder, status, completed) {
        var entity;

        workOrder.status = status;
        workOrder.schedulingComplete = completed;

        entity = workOrders.first(byWorkOrderId(workOrder.workOrderId));
        if (entity) {
            entity.status = status;
            entity.schedulingComplete = completed;
        }

        return Promise.resolve();
    }

    FakeWorkOrderService.prototype.assignWorkOrder = function (workOrder) {
        return setStatus(workOrder, "Scheduled", true);
    };

    FakeWorkOrderService.prototype.unassignWorkOrder = function (workOrder) {
        return setStatus(workOrder, "Accepted", false);
    };

    FakeWorkOrderService.prototype.getWorkOrderDuration =
        function (workOrderId) {
            var workOrder = workOrders.first(byWorkOrderId(workOrderId));

            if (workOrder) {
                return Promise.resolve(workOrder.duration);
            }

            return Promise.reject(new Error("Work order not found."));
        };

    FakeWorkOrderService.prototype.toggleCompleted = function (workOrder) {
        var completed = !workOrder.schedulingComplete;
        return setStatus(workOrder, workOrder.status, completed);
    };

    FakeWorkOrderService.getById = function (workOrderId) {
        var entity, timeZones;
        entity = workOrders.first(byWorkOrderId(workOrderId));
        timeZones = ARS.Fakes.FakeTimeService.getTimeZones();
        return entity ? mapToModel(entity, timeZones) : null;
    };

    return FakeWorkOrderService;
}());

/*global ARS, Promise */

var ARS;
ARS = ARS || {};
ARS.Filters = ARS.Filters || {};
ARS.Filters.FilterBase = (function () {
    "use strict";

    function FilterBase() {
        return undefined;
    }

    return FilterBase;
}());

/*global $, ARS, Promise */

var ARS;
ARS = ARS || {};
ARS.Filters = ARS.Filters || {};
ARS.Filters.RegionFilter = (function () {
    "use strict";

    function bubbleEvent(instance) {
        return function (e) {
            var bubbled, eventArgs;
            bubbled = new $.Event(e, { type: "changeRegion" });
            eventArgs = {};
            eventArgs.selected = instance.getSelected();
            instance.updateRegionText();
            $(instance).triggerHandler(bubbled, eventArgs);
        };
    }

    function RegionFilter(container, attribute, templateService) {
        if (!container) {
            throw new Error("Missing parameter: container");
        }

        if (!attribute) {
            throw new Error("Missing parameter: attribute");
        }

        if (!templateService) {
            throw new Error("Missing parameter: templateService");
        }

        container = $(container);

        this.clearRegions = function () {
            container.empty().multiselect("rebuild");
            this.updateRegionText();
        };

        this.addRegions = function (regions) {
            var template = templateService.getTemplate("regionTemplate");

            regions.forEach(function (region) {
                template(region).appendTo(container);
            });

            container.multiselect("rebuild");
        };

        this.getAttribute = function () {
            return attribute;
        };

        this.getSelected = function () {
            return container
                .find("option:selected")
                .toArray()
                .pluck("value");
        };

        this.selectFirst = function () {
            container.find("option").prop("selected", false);
            container.find("option").first().prop("selected", true);
            container.multiselect("refresh");
            this.updateRegionText();
        };

        this.applyToWorkOrderQuery = function (query) {
            query.clearRegions();

            container
                .find("option:selected")
                .toArray()
                .forEach(function (input) {
                    var name, id;
                    name = input.text;
                    id   = input.value;
                    query.addRegion(id, name);
                });
        };

        this.applyToTechnicianQuery = this.applyToWorkOrderQuery;

        this.updateRegionText = function () {
            var regions, selected, text;

            regions = container.find("option");
            selected = regions.filter(":selected");

            if (selected.length === regions.length || selected.length === 0) {
                text = "Showing all technicians and work orders.";
            } else {
                text = selected.toArray()
                    .pluck("text")
                    .filter(Boolean)
                    .distinct(function (a, b) {
                        return a.toUpperCase() === b.toUpperCase();
                    })
                    .sort(function (a, b) {
                        var x, y;
                        x = a.toUpperCase();
                        y = b.toUpperCase();
                        return x < y ? -1 : x > y ? 1 : 0;
                    })
                    .humanize("or");

                if (text) {
                    text =
                        "Showing all technicians and work orders in " +
                        text + ".";
                } else {
                    text = "Showing all technicians and work orders.";
                }
            }

            $(".now-showing").text(text);
        };

        container.multiselect({
            buttonWidth:            "400px",
            disableIfEmpty:         true,
            includeSelectAllOption: true,
            onChange:               bubbleEvent(this)
        });
    }

    RegionFilter.prototype = Object.create(ARS.Filters.FilterBase.prototype);
    RegionFilter.prototype.constructor = RegionFilter;

    return RegionFilter;
}());

/*global $, ARS, Promise, Tesseract */

var ARS;
ARS = ARS || {};
ARS.Filters = ARS.Filters || {};
ARS.Filters.TechnicianFilter = (function () {
    "use strict";

    function Behavior(filter) {
        this.attach = function () {
            var ev, fn;
            ev = Tesseract.Util.Selection.Event.afterChangeSelection;
            fn = this.onAfterChangeSelection;
            $(filter.selection).on(ev, fn);
        };

        this.onAfterChangeSelection = function (ev, args) {
            var bubble, data, props;
            props = {};
            props.type = "changeTechnician";
            bubble = new $.Event(ev, props);
            data = [];
            data[0] = args.newSelection;
            $(filter).triggerHandler(bubble, data);
        };
    }

    function Dom(container) {
        Object.defineProperties(this, {
            element: { value: $(container) }
        });
    }

    Object.defineProperties(Dom.prototype, {
        active: {
            get: function () {
                return this.technicians.filter(".active");
            }
        },
        technicians: {
            get: function () {
                return this.element.children();
            }
        },
        sortByTechnician: {
            get: function () {
                return $("[data-action='sort-by-technician']");
            }
        }
    });

    Dom.prototype.getByTechnicianId = function (technicianId) {
        var sel = "[data-technician-id='" + technicianId + "']";
        return this.technicians.filter(sel).first();
    };

    function Selection(filter) {
        function prev(item) {
            var techs = filter.technicians;
            return techs[techs.indexOf(item) - 1];
        }

        function next(item) {
            var techs = filter.technicians;
            return techs[techs.indexOf(item) + 1];
        }

        Tesseract.Util.Selection.Selection.call(this, {
            parentElement: filter.dom.element[0],
            elementSelector: "li",
            firstItem: function () {
                return filter.technicians[0];
            },
            getElementByItem: function (item) {
                return filter.dom.getByTechnicianId(item.technicianId)[0];
            },
            getItemByElement: function (element) {
                var tech;
                tech = $(element).data("technician-id");
                tech = filter.technicians.first(function (t) {
                    return t.technicianId === tech;
                });

                return tech;
            },
            getItemAbove: prev,
            getItemBelow: next,
            getItemLeft: prev,
            getItemRight: next,
            between: function (tech1, tech2) {
                var cursor, indicies, result, techs;
                techs = filter.technicians;
                indicies = [ tech1, tech2 ].map(function (tech) {
                    return techs.indexOf(tech);
                }).sort();
                result = [];
                cursor = indicies[0];
                while (cursor <= indicies[1]) {
                    result.push(techs[cursor]);
                    cursor += 1;
                }

                return result;
            }
        });
    }

    Selection.prototype =
        Object.create(Tesseract.Util.Selection.Selection.prototype);

    function TechnicianFilter(container, template) {
        if (!container) {
            throw new Error("Missing parameter: container");
        }

        if (!template) {
            throw new Error("Missing parameter: template");
        }

        var instance         = {};
        instance.technicians = [];

        Object.defineProperty(this, "dom", { value: new Dom(container) });

        Object.defineProperties(this, {
            behavior:  { value: new Behavior(this)  },
            selection: { value: new Selection(this) },
            selectedTechnicians: {
                get: function () {
                    return this.selection.selected;
                }
            },
            technicians: {
                get: function () {
                    return instance.technicians.slice(0);
                }
            }
        });

        this.clearTechnicians = function () {
            this.clearSelection();
            this.dom.element.empty();
            instance.technicians.length = [];
        };

        this.addTechnician = function (technician) {
            var exists = instance.technicians.first(function (t) {
                t.equals(technician);
            });

            if (exists) {
                return;
            }

            technician.toHtml(template).appendTo(this.dom.element);
            instance.technicians.push(technician);
        };

        this.behavior.attach();
        this.selection.attach();
    }

    TechnicianFilter.prototype =
        Object.create(ARS.Filters.FilterBase.prototype);

    TechnicianFilter.prototype.constructor = TechnicianFilter;

    TechnicianFilter.prototype.addTechnicians = function (technicians) {
        technicians.forEach(this.addTechnician, this);
    };

    TechnicianFilter.prototype.clearSelection = function () {
        this.selection.trySetSelection(this.technicians, []);
        this.updateSortability();
    };

    TechnicianFilter.prototype.selectByElement = function (el) {
        var $el = $(el);

        if ($el.parent().is(this.dom.element)) {
            $el.addClass("active");
            this.updateSortability();
        }
    };

    TechnicianFilter.prototype.selectFirst = function () {
        var unselect, select;
        select = this.technicians.slice(0, 1);
        unselect = this.technicians.except(select);
        this.selection.trySetSelection(unselect, select);
        this.updateSortability();
    };

    TechnicianFilter.prototype.updateSortability = function () {
        var canSort = this.selectedTechnicians.length === 1;
        this.dom.sortByTechnician.prop("disabled", !canSort);
    };

    TechnicianFilter.prototype.selectTechnicianById = function (technicianId) {
        var unselect, select;

        select = this.technicians.filter(function (t) {
            return t.technicianId === technicianId;
        });

        unselect = this.technicians.except(select);

        this.selection.trySetSelection(unselect, select);
        this.updateSortability();
    };

    TechnicianFilter.prototype.applyToServiceAppointmentQuery =
        function (query) {
            query.clearTechnicians();
            this.selectedTechnicians.forEach(query.addTechnician, query);
        };

    return TechnicianFilter;
}());

/*global $, ARS, Promise */

var ARS;
ARS = ARS || {};
ARS.Filters = ARS.Filters || {};
ARS.Filters.TicketFilter = (function () {
    "use strict";

    function Behavior(instance) {
        this.attach = function () {
            instance.$element.on("keyup", this.onKeyUp_Element);
        };

        this.onKeyUp_Element = function (e) {
            var bubbled = new $.Event(e, { type: "changeTicket" });
            $(instance.self).triggerHandler(bubbled);
        };
    }

    function TicketFilter(attribute, element) {
        if (!attribute) {
            throw new Error("Missing parameter: attribute");
        }

        if (!element) {
            throw new Error("Missing parameter: element");
        }

        var instance       = {};
        instance.$element  = $(element);
        instance.attribute = attribute;
        instance.behavior  = new Behavior(instance);
        instance.self      = this;

        this.getAttribute = function () {
            return instance.attribute;
        };

        this.getValue = function () {
            return instance.$element.val();
        };

        instance.behavior.attach();
    }

    TicketFilter.prototype = Object.create(ARS.Filters.FilterBase.prototype);
    TicketFilter.prototype.constructor = TicketFilter;

    TicketFilter.prototype.applyToWorkOrderQuery = function (query) {
        query.ticket = this.getValue();
    };

    return TicketFilter;
}());

/*global $, ARS, Promise */

var ARS;
ARS = ARS || {};
ARS.Filters = ARS.Filters || {};
ARS.Filters.WorkOrderFilter = (function () {
    "use strict";

    function mapSelectionToCodes(selection, codes) {
        var keys = "";

        switch (selection) {
        case "Unassigned":
            keys = [ "Accepted" ];
            break;

        case "Return - Need for Parts":
            keys = [ selection ];
            break;

        case "Return - Need to Quote":
            keys = [ selection ];
            break;

        case "Recall":
            keys = [ selection ];
            break;

        case "Pending":
            keys = [ selection ];
            break;

        case "Work Complete":
            keys = [ selection ];
            break;

        case "In Progress":
            keys = [ selection ];
            break;

        case "Need to Quote - Electrical":
            keys = [ selection ];
            break;

        case "Need to Quote - Plumbing":
            keys = [ selection ];
            break;

        case "Need to Quote - General":
            keys = [ selection ];
            break;

        case "All":
            keys = [
                "Accepted", "In Progress", "Recall", "Return - Need for Parts",
                "Return - Need to Quote", "Scheduled", "Technician Offsite",
                "Work Complete", "Pending", "Need to Quote - Electrical", "Need to Quote - General", "Need to Quote - Plumbing"
            ];
            break;

        default:
            throw new Error("Unrecognized selection: " + selection);
        }

        return codes.filter(function (codes) {
            return keys.indexOf(codes.label) !== -1;
        }).pluck("value");
    }

    function Behavior(instance) {
        this.attach = function () {
            var ev, sel, fn;
            ev  = "click";
            sel = "li";
            fn  = this.onClick_Item;
            instance.$element.on(ev, sel, fn);
        };

        this.onClick_Item = function (e) {
            var bubbled;

            instance.self.setSelectedByElement(e.target);

            bubbled = new $.Event(e, { type: "changeWorkOrderFilter" });
            $(instance.self).triggerHandler(bubbled);
        };
    }

    function WorkOrderFilter(element, incidentCodes) {
        if (!element) {
            throw new Error("Missing parameter: element");
        }

        if (!incidentCodes) {
            throw new Error("Missing parameter: incidentCodes");
        }

        var instance            = {};
        instance.$element       = $(element);
        instance.behavior       = new Behavior(instance);
        instance.incidentCodes  = incidentCodes;
        instance.self           = this;

        Object.defineProperties(this, {
            includeCompletedSchedules: {
                get: function () {
                    return this.selected !== "Unassigned";
                }
            },
            selected: {
                get: function () {
                    var selected = instance.$element
                        .find(".active")
                        .first()
                        .attr("id");

                    return selected || "All";
                }
            },
            selectedCodes: {
                get: function () {
                    var codes, selection;
                    codes     = instance.incidentCodes;
                    selection = this.selected;
                    return mapSelectionToCodes(selection, codes);
                }
            }
        });

        this.setSelectedByElement = function (el) {
            var $item;
            $item = $(el).closest("li");

            if ($item.parent().is(instance.$element)) {
                instance.$element.find("li.active").removeClass("active");
                $item.addClass("active");
                $(".order-title").text($item.text());
            }
        };

        instance.behavior.attach();
    }

    WorkOrderFilter.prototype =
        Object.create(ARS.Filters.FilterBase.prototype);

    WorkOrderFilter.prototype.constructor = WorkOrderFilter;

    WorkOrderFilter.prototype.applyToWorkOrderQuery = function (query) {
        query.includeCompletedSchedules = this.includeCompletedSchedules;
        query.clearStatusCodes();
        this.selectedCodes.forEach(query.addStatusCode, query);
    };

    return WorkOrderFilter;
}());

/*global $, ARS, Promise, Xrm, window */

var ARS;
ARS = ARS || {};
ARS.GlobalContext = (function () {
    "use strict";

    var localDomains;

    localDomains = [
        "localhost",
        "ars.dispatch.chris.arkesystems.com"
    ];

    // We are having difficulty with CRM loading the global context.
    //
    // CRM is giving us a path that includes the organization name. This is
    // resulting in a 404 error.
    //
    // If we use a path without the organization name, it works.
    //
    // We do not know why this is, nor how to fix it.  So, this is a hack.

    // Also, we find it useful to know when the global context has
    // finished loading.

    function getWebResourcePath() {
        var component, idx, path;

        path      = window.location.toString();
        component = "/WebResources/";
        idx       = path.indexOf(component);

        if (idx === -1) {
            throw new Error("Cannot resolve WebResources path.");
        }

        return path.substring(0, idx + component.length);
    }

    function unescapeHexString(s) {
        /*jslint unparam: true */
        return s.replace(/\\x([0-9A-F]{2})/gi, function (ignore, c) {
            return String.fromCharCode(parseInt(c, 16));
        });
    }

    /// <summary>
    /// Extract the path to the dynamic script tags included in the
    /// first response.
    /// </summary>
    function getScriptPaths(text) {
        var extractScriptPaths, match, result;

        extractScriptPaths =
            "^document.write\\('<script type=\"text\\/javascript\" " +
            "src=\"'\\+'([^']+?)'\\+'\"><\\/'\\+'script>'\\)$";

        extractScriptPaths = new RegExp(extractScriptPaths, "gm");

        result = [];
        match = extractScriptPaths.exec(text);
        while (match !== null) {
            result.push(unescapeHexString(match[1]));
            match = extractScriptPaths.exec(text);
        }

        return result;
    }

    function getContextPath(text) {
        var extractPath, match;

        extractPath = /^xhr\.open\("GET",\s"([\s\S]+?)"/gm;

        match = extractPath.exec(text);

        if (match) {
            return unescapeHexString(match[1]);
        }

        throw new Error("Cannot resolve ClientGlobalContext.js.aspx path.");
    }

    /// <summary>
    /// Load the dynamic scripts as indicated by the first response.
    /// </summary>
    function loadDynamicScripts(context) {
        var scriptPaths = context.scriptPaths;
//        var temp = scriptPaths[0];
//        scriptPaths[0] = scriptPaths[6];
//        scriptPaths[6] = temp;
//        console.log("scriptPaths Length: " + scriptPaths.length);

        //console.log("scriptPaths: " + scriptPaths);

        return new Promise(function (resolve, reject) {
            var loadScript, loadNext, settings;

            function failure() {
                var err = new Error("Unable to load " + settings.url);
                reject(err);
            }


            settings = {};
            settings.dataType    = "script";
            settings.contentType = false;
            settings.cache       = true;

            loadScript = function (path) {
                settings.url = path;

                if (path) {
                    $.ajax(settings).then(loadNext, failure);
                } else {
                    resolve(context);
                }
            };

            loadNext = function () {
                loadScript(scriptPaths.shift());
            };

            loadNext();
        });
    }

    function loadClientContext(context) {

        // In this case, we do not fully trust the CRM path.  In our
        // dev environment, it is causing a 404 error.  However, we still
        // want to try it--since we don't know why it broke, we don't know
        // whether it might suddenly be fixed.

        // Note: As of 2015-07-17, this was suddenly fixed.  Let's leave the
        // code here, you know, just in case.  Honestly, it looks like it
        // might break again soon anyway.  The root problem has something to
        // do with the SSL configuration and the way this instance of the
        // CRM installation is licensed.

        return new Promise(function (resolve, reject) {
            var settings;

            function complete() {
                resolve(context);
            }

            settings             = {};
            settings.url         = context.contextPath;
            settings.dataType    = "script";
            settings.contentType = "application/json";

            $.ajax(settings).done(complete).fail(function () {
                var idx;

                // Now try again, removing the organization name from the URL.
                idx          = context.contextPath.indexOf("/", 1);
                settings.url = context.contextPath.substring(idx);

                $.ajax(settings).done(complete).fail(function () {
                    var err;
                    err = "Unable to load ClientGlobalContext.js.aspx";
                    err = new Error(err);
                    reject(err);
                });
            });
        });
    }

    function exportGlobalContext(context) {
        /// <summary>Export a global function.</summary>

        window.GetGlobalContext = function() {
            // ReSharper disable once UndeclaredGlobalVariableUsing
            // The point of this file is to load the libraries that provide
            // the Xrm variable.  This variable won't become available until
            // mid-way through this file's processing.
            return Xrm.Page.context;
        };

        return context;
    }

    /// <summary>Process the first response.</summary>
    function processFirstResponse(response) {
        var result;
        result = {};
        result.scriptPaths = getScriptPaths(response);
        result.contextPath = getContextPath(response);
        return result;
    }

    function GlobalContext() {
        return undefined;
    }

    GlobalContext.prototype.load = function () {
        // We need CRM to tell us the paths to the script tags to load.
        var hostName, url, xhr;

        // The ClientGlobalContext.js.aspx file is a CRM component, and is not
        // available locally.  Local development uses fake data instead.
        hostName = window.location.hostname.toLowerCase();
        if (localDomains.indexOf(hostName) !== -1) {
            return Promise.resolve();
        }

        url = getWebResourcePath() + "ClientGlobalContext.js.aspx";

        xhr = $.ajax({
            url: url,
            dataType: "text" // Override jQuery's guesswork in this case.
        });

        return Promise.resolve(xhr)
            .then(processFirstResponse)
            .then(loadDynamicScripts)
            .then(exportGlobalContext)
            .then(loadClientContext);
    };

    return new GlobalContext();
}());

/*global $, ARS, document, moment, Promise, window */

var ARS;
ARS = ARS || {};
ARS.defaultCallback = function() {
    "use strict";
    throw new Error("Not implemented yet");
};

ARS.Index = (function () {
    "use strict";

    // ReSharper disable once InconsistentNaming
    // Match the namespace spelling.
    var Index;

    Index = {};

    function byDistance(a, b) {
        if (a.distance < b.distance) {
            return -1;
        }

        if (a.distance > b.distance) {
            return 1;
        }

        return 0;
    }

    function loadAppointments() {
        var end, start, tasks, tz;

        tz    = Index.calendarView.selectedTimeZone;
        start = Index.calendarView.scheduleStart;
        end   = Index.calendarView.scheduleEnd;
        tasks = [];
        tasks[0] = Index.timeService.utcTimeFromLocalTime(start, tz);
        tasks[1] = Index.timeService.utcTimeFromLocalTime(end, tz);

        return Promise.all(tasks).then(function (results) {
            var filters;

            start = results[0];
            end   = results[1];

            filters = [];
            filters[0] = Index.searchFilterFactory.getTechnicianFilter();
            filters[1] = new ARS.Filters.DateRangeFilter(start, end);

            return Index.serviceAppointmentService
                .getServiceAppointmentsAsync(filters);
        }).then(function (appointments) {
            return Index.timeService.setAppointmentTimeZones(appointments, tz);
        });
    }

    // ReSharper disable once Html.EventNotResolved
    // This is some bluebird sorcery.
    window.addEventListener("unhandledrejection", function (e) {
        e.preventDefault();
        Index.notificationService.showError(e.detail.reason);
        Index.animationService.hideBusyAnimation(true);
    });

    Index.updateRegionsAsync = function () {
        return Index.regionService.getRegionsAsync().then(function (regions) {
            Index.searchFilterFactory.clearRegions();
            Index.searchFilterFactory.addRegions(regions);
            Index.searchFilterFactory.selectFirstRegion();
            return regions;
        });
    };

    Index.clearAppointments = function () {
        Index.mapView.clearAppointments();
        Index.calendarView.clearAppointments();
    };

    Index.addAppointments = function (appointments) {
        Index.mapView.addAppointments(appointments);
        Index.calendarView.addAppointments(appointments);
    };

    Index.updateAppointmentsAsync = function () {
        return loadAppointments().then(function (appointments) {
            Index.clearAppointments();
            Index.addAppointments(appointments);
            return appointments;
        });
    };

    Index.addAppointmentAsync = function (tech, workOrder, start, timeZone) {
        var tasks;

        tasks = [];

        tasks[0] = Index.workOrderService
            .getWorkOrderDuration(workOrder.workOrderId);

        tasks[1] = Index.timeService
            .convertTimeZone(start, timeZone, this.userTimeZone);

        return Promise.all(tasks).then(function (results) {
            var duration, userEnd, userStart;

            duration  = moment.duration(results[0], "hours");
            userStart = moment(results[1]);
            userEnd   = moment(userStart).add(duration);

            tasks = [];

            tasks[0] = Index.workOrderService.assignWorkOrder(workOrder);

            tasks[1] = Index.serviceAppointmentService
                .createServiceAppointmentAsync(
                    workOrder,
                    tech,
                    userStart,
                    userEnd
                );

            return Promise.all(tasks);
        }).then(function () {
            tasks = [];
            tasks[0]  = Index.updateWorkOrdersAsync();
            tasks[1]  = Index.updateAppointmentsAsync();
            return Promise.all(tasks);
        });
    };

    Index.clearTechnicians = function () {
        Index.searchFilterFactory.clearTechnicians();
        Index.mapView.clearTechnicians();
        Index.calendarView.technicians = [];
        Index.clearAppointments();
    };

    Index.loadTechniciansAsync = function () {
        var filters = [];
        filters.push(Index.searchFilterFactory.getRegionFilter());
        return Index.technicianService.getTechniciansAsync(filters);
    };

    Index.updateTechniciansAsync = function () {
        return Index.loadTechniciansAsync().then(function (technicians) {
            Index.clearTechnicians();
            Index.searchFilterFactory.addTechnicians(technicians);
            Index.searchFilterFactory.selectFirstTechnician();

            var selected = Index.searchFilterFactory.selectedTechnicians;
            Index.mapView.addTechnicians(selected);
            Index.calendarView.technicians = selected;

            if (selected.length > 0) {
                return Index.updateAppointmentsAsync().then(function () {
                    return technicians;
                });
            }

            return technicians;
        });
    };

    Index.sortTechniciansByDistanceToWorkOrderAsync = function (workOrder) {
        var tasks, time, timeZone;

        time     = Index.calendarView.selectedTime;
        timeZone = Index.calendarView.selectedTimeZone;

        tasks    = [];
        tasks[0] = Index.loadTechniciansAsync();
        tasks[1] = Index.timeService.utcTimeFromLocalTime(time, timeZone);

        return Promise.all(tasks).then(function (results) {
            var techs, to, utcTime;

            techs   = results[0];
            utcTime = results[1];
            to      = workOrder.latLng;

            tasks = techs.map(function (tech) {
                return Index.serviceAppointmentService
                    .getTechnicianDistanceAsync(tech, utcTime, to)
                    .then(function (distance) {
                        var viewModel      = {};
                        viewModel.tech     = tech;
                        viewModel.distance = distance;
                        return viewModel;
                    });
            });

            return Promise.all(tasks);
        }).then(function (withDistances) {
            var selected, sorted;

            sorted = withDistances.sort(byDistance).map(function (a) {
                return a.tech;
            });

            selected = Index.searchFilterFactory.selectedTechnicians.first();

            Index.searchFilterFactory.clearTechnicians();
            Index.searchFilterFactory.addTechnicians(sorted);

            // Reselect the same tech, so we don't have to clear and re-load
            // the map, appointments, or calendar.  If the user wants to
            // select a different tech, they can do that themselves.
            if (selected) {
                Index.searchFilterFactory
                    .selectTechnicianById(selected.technicianId);
            }
        });
    };

    Index.clearWorkOrders = function () {
        Index.workOrderView.clearWorkOrderDetails();
        Index.workOrderView.clearWorkOrders();
        Index.mapView.clearWorkOrders();
    };

    Index.addWorkOrders = function (workOrderPage) {
        Index.workOrderView.addWorkOrders(workOrderPage);
        Index.mapView.addWorkOrders(workOrderPage.workOrders);
    };

    Index.loadWorkOrdersAsync = function () {
        var criteria, filters, paging;
        criteria = Index.searchFilterFactory;

        filters = [];
        filters.push(criteria.getRegionFilter());
        filters.push(criteria.getWorkOrderFilter());
        filters.push(criteria.getAllUsersFilter());
        filters.push(criteria.getTicketFilter());

        paging = {};
        paging.page = Index.workOrderView.page + 1;
        paging.cookie = Index.workOrderView.pagingCookie;

        return Index.workOrderService.getWorkOrdersAsync(filters, paging);
    };

    Index.loadWorkOrdersAndDistancesAsync = function () {
        var self, tech, time, timeZone;

        self = this;

        tech = this.searchFilterFactory.selectedTechnicians;

        if (tech.length !== 1) {
            return Promise.reject("Please select exactly one technician.");
        }

        tech     = tech[0];
        time     = this.calendarView.selectedTime;
        timeZone = this.calendarView.selectedTimeZone;

        return this.timeService
            .utcTimeFromLocalTime(time, timeZone)
            .then(function (utcTime) {
                return self.serviceAppointmentService
                    .getTechnicianCoordinatesAsync(tech, utcTime);
            })
            .then(function (techLocation) {
                var latLng = techLocation ? techLocation.latLng : null;

                function getDistances(workOrderPage) {
                    var workOrders = workOrderPage.workOrders;
                    return Index.geoLocationService
                        .getWorkOrderDistancesAsync(latLng, workOrders)
                        .then(function (withDistances) {
                            workOrderPage.workOrders = withDistances;
                            return workOrderPage;
                        });
                }

                if (latLng instanceof ARS.Models.LatLng === false) {
                    throw new Error("Cannot plot technician location.");
                }

                Index.clearWorkOrders();
                return Index.loadWorkOrdersAsync().then(getDistances);
            })
            .then(function (withDistances) {
                withDistances.workOrders =
                    withDistances.workOrders.sort(byDistance);

                Index.addWorkOrders(withDistances);
                return withDistances;
            });
    };

    Index.updateWorkOrdersAsync = function () {
        Index.clearWorkOrders();
        return Index.loadWorkOrdersAsync().then(Index.addWorkOrders);
    };

    Index.loadMoreWorkOrdersAsync = function () {
        // Skip clearing existing work orders.
        return Index.loadWorkOrdersAsync().then(Index.addWorkOrders);
    };

    Index.toggleCompleted = function (workOrder) {
        return Index.workOrderService.toggleCompleted(workOrder);
    };

    Index.updateWorkOrderDetail = function () {
        var selected = Index.workOrderView.getSelectedWorkOrder();

        if (selected && selected.workOrderId) {
            Index.workOrderView.showWorkOrderDetails(selected);
        } else {
            Index.workOrderView.clearWorkOrderDetails();
        }
    };

    function initialize() {
        Index.animationService    = ARS.Services.AnimationService;
        Index.heartbeatService    = new ARS.Services.HeartbeatService();
        Index.notificationService = new ARS.Services.NotificationService();
        Index.serviceFactory      = ARS.ServiceFactory;
        Index.templateService     = new ARS.Services.TemplateService();
        Index.viewFactory         = new ARS.ViewFactory();

        Index.workOrderView = Index.viewFactory
            .createWorkOrderView(Index.templateService);

        Index.animationService.showBusyAnimation();

        ARS.GlobalContext.load()
            .then(function () {
                var factory, nextTasks, repo;

                factory = Index.serviceFactory;
                repo    = factory.createDataRepository();

                Index.dataRepository    = repo;
                Index.regionService     = factory.createRegionService();
                Index.settingsService   = factory.createSettingsService();
                Index.technicianService = factory.createTechnicianService();
                Index.timeService       = factory.createTimeService();
                Index.workOrderService  = factory.createWorkOrderService();

                nextTasks = [];
                nextTasks[0] = Index.settingsService.getBingMapsKeyAsync();
                nextTasks[1] = Index.workOrderService.getStatusCodesAsync();
                nextTasks[2] = Index.timeService.getCurrentUserTimeZoneAsync();
                nextTasks[3] = Index.timeService.getSupportedTimeZonesAsync();
                return Promise.all(nextTasks);
            })
            .then(function (results) {
                var bingMapsKey, factory, geo, incidentStatusCodes,
                    timeZones, userTime;

                bingMapsKey         = results[0];
                incidentStatusCodes = results[1];
                userTime            = results[2];
                timeZones           = results[3];

                Index.userTimeZone = userTime;

                Index.searchFilterFactory = new ARS.SearchFilterFactory(
                    Index.templateService,
                    incidentStatusCodes);

                factory = Index.serviceFactory;

                geo = new ARS.Services.GeoLocationService(bingMapsKey);
                Index.geoLocationService = geo;

                Index.serviceAppointmentService =
                    factory.createServiceAppointmentService(geo);

                Index.mapView = Index.viewFactory.createMapView(
                    bingMapsKey,
                    Index.geoLocationService,
                    Index.notificationService
                );

                Index.calendarView = Index.viewFactory.createCalendarView(
                    Index.workOrderView,
                    userTime,
                    timeZones
                );

                Index.indexController =
                    new ARS.Controllers.IndexController(Index);

                return Index.updateRegionsAsync();
            })
            .then(function () {
                var nextTasks = [];
                nextTasks[0] = Index.updateWorkOrdersAsync();
                nextTasks[1] = Index.updateTechniciansAsync();
                return Promise.all(nextTasks);
            })
            .then(function () {
                Index.mapView.zoomToPins();
                Index.heartbeatService.start();
            })
            .finally(Index.animationService.hideBusyAnimation);
    }

    $(initialize);

    return Index;
}());

/*global $, window */

$(function() {
    "use strict";

    // demo only
    $('.fc-axis')
        .on('click', function(){
            $('.fc-axis').removeClass('selected');
            $(this).toggleClass('selected');
        });

    $("body").layout({
        applyDefaultStyles: true,
        north__resizable: false,
        south__applyDefaultStyles: false,
        north__applyDefaultStyles: false,
        east__size: $(window).width() * (1/3)
    });
});

var ARS;
ARS = ARS || {};
ARS.Models = ARS.Models || {};
ARS.Models.IncidentStatusCode = (function () {
    "use strict";

    function IncidentStatusCode(label, value) {
        label = String(label || "").trim();
        value = parseInt(value, 10);

        if (isNaN(value)) {
            throw new TypeError("value must be a number.");
        }

        if (isFinite(value) === false) {
            throw new RangeError("value must be finite.");
        }

        Object.defineProperties(this, {
            label: {
                get: function () {
                    return label;
                }
            },
            value: {
                get: function () {
                    return value;
                }
            }
        });
    }

    IncidentStatusCode.fromOptionSet = function (optionSet) {
        return new IncidentStatusCode(optionSet.label, optionSet.value);
    };

    return IncidentStatusCode;
}());

/*global $, ARS, google, Microsoft, window */

var ARS;
ARS = ARS || {};
ARS.Models = ARS.Models || {};
ARS.Models.LatLng = (function () {
    "use strict";
    /*jslint unparam: true */

    var pointRe = /^POINT\ \((-?\d+(?:\.\d+))\ (-?\d+(?:\.\d+))\)$/;

    function googleMapsDefined() {
        return window.google &&
            window.google.maps &&
            $.isFunction(window.google.maps.LatLng);
    }

    function bingMapsDefined() {
        return window.Microsoft &&
            window.Microsoft.Maps &&
            $.isFunction(window.Microsoft.Maps.Location);
    }

    function isGoogleLatLng(value) {
        return googleMapsDefined() &&
            value instanceof window.google.maps.LatLng;
    }

    function isMicrosoftLatLng(value) {
        return bingMapsDefined() &&
            value instanceof window.Microsoft.Maps.Location;
    }

    function isGeographyPoint(value) {
        pointRe.lastIndex = 0;
        value = value === null || value === undefined ? "" : String(value);
        return pointRe.test(value);
    }

    function LatLng(latitude, longitude) {
        /// <signature>
        ///   <summary>Describe latitude and longitude.</summary>
        ///   <param name="gLatLng" type="google.maps.LatLng">
        ///     Google LatLng
        ///   </param>
        /// </signature>
        /// <signature>
        ///   <summary>Describe latitude and longitude.</summary>
        ///   <param name="gLatLng" type="Microsoft.Maps.Location">
        ///     Microsoft Maps Location
        ///   </param>
        /// </signature>
        /// <signature>
        ///   <summary>Describe latitude and longitude.</summary>
        ///   <param name="latitude" type="Number">Latitude</param>
        ///   <param name="longitude" type="Number">Longitude</param>
        /// </signature>
        /// <signature>
        ///   <summary>Describe latitude and longitude.</summary>
        ///   <param name="point" type="SqlGeography.Point">
        ///     Sql Geography
        ///   </param>
        /// </signature>

        var instance, match;

        instance = {};
        instance.lat = null;
        instance.lng = null;

        this.getLatitude = function () {
            return instance.lat;
        };

        this.getLongitude = function () {
            return instance.lng;
        };

        if (isGoogleLatLng(latitude)) {
            instance.lat = latitude.lat();
            instance.lng = latitude.lng();
        } else if (isMicrosoftLatLng(latitude)) {
            instance.lat = latitude.latitude;
            instance.lng = latitude.longitude;
        } else if (isGeographyPoint(latitude)) {
            match = pointRe.exec(latitude);
            instance.lat = Number(match[2]);
            instance.lng = Number(match[1]);
        } else {
            if (latitude === null || latitude === undefined) {
                throw new Error("Expecting a latitude.");
            }

            if (longitude === null || longitude === undefined) {
                throw new Error("Expecting a longitude.");
            }

            instance.lat = Number(latitude);
            instance.lng = Number(longitude);

            if (isNaN(instance.lat)) {
                throw new TypeError("latitude must be a number");
            }

            if (isNaN(instance.lng)) {
                throw new TypeError("longitude must be a number.");
            }

            if (instance.lat < -90 || instance.lat > 90) {
                throw new RangeError("latitude must range from -90 to 90.");
            }

            if (instance.lng < -180 || instance.lng > 180) {
                throw new RangeError("longitude must range from -180 to 180.");
            }
        }
    }

    LatLng.tryCreate = function (latitude, longitude) {
        try {
            return new LatLng(latitude, longitude);
        } catch (ex) {
            return null;
        }
    };

    LatLng.prototype.toGoogleLatLng = function () {
        var lat, lng;
        if (googleMapsDefined()) {
            lat = this.getLatitude();
            lng = this.getLongitude();
            return new window.google.maps.LatLng(lat, lng);
        }

        return null;
    };

    LatLng.prototype.toMicrosoftLatLng = function () {
        var lat, lng;
        if (bingMapsDefined()) {
            lat = this.getLatitude();
            lng = this.getLongitude();
            return new window.Microsoft.Maps.Location(lat, lng);
        }

        return null;
    };

    LatLng.prototype.toString = function () {
        /// <summary>Return a lat lng combination as a string.</summary>
        var result = [ this.getLatitude(), this.getLongitude() ];
        result = result.join(", ");
        return result;
    };

    LatLng.prototype.toPointString = function () {
        /// <summary>Render this lat lng as a SqlGeography POINT</summary>
        var result =
            "POINT (" + this.getLongitude() + " " + this.getLatitude() + ")";

        return result;
    };

    LatLng.prototype.equals = function (latLng) {
        /// <summary>Compare a LatLng object with this LatLng.</summary>
        /// <param name="latLng" type="LatLng">
        ///   The LatLng object to compare with.
        /// </param>
        /// <return type="boolean">True if equal; otherwise, false.</return>

        if (latLng && latLng instanceof LatLng) {
            return this.getLatitude() === latLng.getLatitude &&
                this.getLongitude() === latLng.getLongitude();
        }

        return false;
    };

    LatLng.prototype.getDistanceInMiles = function (latLng) {

        function toRadians(value) {
            return value * Math.PI / 180;
        }

        if (latLng instanceof LatLng === false) {
            throw new TypeError("Expecting a LatLng.");
        }

        var a, earthRadius, latDistance, lngDistance;

        earthRadius = 3959;

        latDistance = toRadians(latLng.getLatitude() - this.getLatitude());
        lngDistance = toRadians(latLng.getLongitude() - this.getLongitude());

        a = // haversine formula
            Math.sin(latDistance / 2) *
            Math.sin(latDistance / 2) +
            Math.cos(toRadians(this.getLatitude())) *
            Math.cos(toRadians(latLng.getLatitude())) *
            Math.sin(lngDistance / 2) *
            Math.sin(lngDistance / 2);

        return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    return LatLng;
}());

/*global moment */

var ARS;
ARS = ARS || {};
ARS.Models = ARS.Models || {};
ARS.Models.ServiceAppointment = (function () {
    "use strict";

    function getterFor(context, name) {
        return function () {
            return context[name];
        };
    }

    function stringValueFor(context, name) {
        return {
            get: getterFor(context, name),
            set: function (value) {
                context[name] =  value === null || value === undefined ?
                    null : String(value).trim();
            }
        };
    }

    function typedValueFor(context, name, Type) {
        return {
            get: getterFor(context, name),
            set: function (value) {
                context[name] = value instanceof Type ? value : null;
            }
        };
    }

    function workOrderValueFor(context, name) {
        return typedValueFor(context, name, ARS.Models.WorkOrderModel);
    }

    function techValueFor(context, name) {
        return typedValueFor(context, name, ARS.Models.Technician);
    }

    function ServiceAppointment() {
        var instance = {};
        instance.appointmentId  = null;
        instance.schedule       = {};
        instance.technician     = null;
        instance.utcEnd         = null;
        instance.utcStart       = null;
        instance.workOrder      = null;

        Object.defineProperties(this, {
            appointmentId: stringValueFor(instance, "appointmentId"),
            utcStart:      stringValueFor(instance, "utcStart"),
            utcEnd:        stringValueFor(instance, "utcEnd"),
            technician:    techValueFor(instance, "technician"),
            workOrder:     workOrderValueFor(instance, "workOrder")
        });

        this.addLocalSchedule = function (timeZone, zoneStart, zoneEnd) {
            var schedule = {};
            schedule.start = zoneStart;
            schedule.end   = zoneEnd;
            instance.schedule[timeZone.standardName] = Object.freeze(schedule);
        };

        this.getLocalSchedule = function (timeZone) {
            var name = timeZone.standardName;
            if (instance.schedule.hasOwnProperty(name) === false) {
                throw new RangeError("Local schedule not found for " + name);
            }

            return instance.schedule[name];
        };
    }

    Object.defineProperties(ServiceAppointment.prototype, {
        technicianIsLate: {
            get: function () {
                var isLate, hasStatus, hasStart, status, utcStart, utcNow;

                hasStatus = this.workOrder && this.workOrder.status;
                hasStart  = this.utcStart;

                if (!(hasStatus && hasStart)) {
                    return false;
                }

                status   = this.workOrder.status;
                utcStart = moment.utc(this.utcStart);
                utcNow   = moment.utc();

                isLate =
                    utcStart.isBefore(utcNow) &&
                    status === "Scheduled";

                return Boolean(isLate);
            }
        }
    });

    ServiceAppointment.prototype.equals = function (other) {
        var x, y;

        if (other instanceof ServiceAppointment === false) {
            return false;
        }

        x = String(this.appointmentId || "").trim().toLowerCase();
        y = String(other.appointmentId || "").trim().toLowerCase();

        return x === y;
    };

    return ServiceAppointment;
}());

var ARS;
ARS = ARS || {};
ARS.Models = ARS.Models || {};
ARS.Models.Technician = (function () {
    "use strict";

    function getterFor(context, name) {
        return function () {
            return context[name];
        };
    }

    function stringValue(context, name) {
        return {
            get: getterFor(context, name),
            set: function (value) {
                context[name] = value === null || value === undefined ?
                    null :
                    String(value).trim();
            }
        };
    }

    function getCompositeAddress(tech) {
        var result = [ tech.streetAddress, tech.city, tech.state, tech.zip ];
        return result.filter(Boolean).join(" ");
    }

    function Technician() {
        var instance = {};
        instance.technicianId = null;
        instance.city         = null;
        instance.latLng       = null;
        instance.name         = null;
        instance.state        = null;
        instance.street       = null;
        instance.timeZone     = null;
        instance.zip          = null;
        instance.trade        = null;

        [
            "technicianId", "city", "name", "state", "street", "zip", "trade"
        ].forEach(function (key) {
            Object.defineProperty(this, key, stringValue(instance, key));
        }, this);

        Object.defineProperties(this, {
            addressComposite: {
                get: function () {
                    return getCompositeAddress(this);
                }
            },
            latLng: {
                get: getterFor(instance, "latLng"),
                set: function (value) {
                    instance.latLng =
                        value instanceof ARS.Models.LatLng ? value : null;
                }
            },
            timeZone: {
                get: getterFor(instance, "timeZone"),
                set: function (value) {
                    instance.timeZone =
                        value instanceof ARS.Models.TimeZone ? value : null;
                }
            }
        });
    }

    Technician.prototype.equals = function (other) {
        if (other instanceof Technician === false) {
            return false;
        }

        if (this.technicianId === null) {
            return other.technicianId === null;
        }

        if (other.technicianId === null) {
            return false;
        }

        var a, b;
        a = this.technicianId.toLowerCase();
        b = other.technicianId.toLowerCase();

        return a === b;
    };

    Technician.prototype.toHtml = function (template) {
        var viewModel = {};

        [
            "technicianId", "street", "city", "state", "zip", "name", "trade"
        ].forEach(function (prop) {
            viewModel[prop] = this[prop] || "";
        }, this);

        viewModel.latLng = this.latLng ?
            this.latLng.toPointString() : "";

        viewModel.timeZone = this.timeZone ?
            this.timeZone.standardName || "" :
            null;

        return template(viewModel);
    };

    return Technician;
}());

var ARS;
ARS = ARS || {};
ARS.Models = ARS.Models || {};
ARS.Models.TimeZone = (function () {
    "use strict";

    var cache = {};

    function TimeZone(standardName, userInterfaceName, code) {
        standardName = String(standardName || "").trim();
        userInterfaceName = String(userInterfaceName || "").trim();

        if (!standardName) {
            throw new Error("standardName is required.");
        }

        if (!userInterfaceName) {
            throw new Error("userInterfaceName is required.");
        }

        code = parseInt(code, 10);

        if (isNaN(code)) {
            throw new TypeError("code must be a number.");
        }

        if (isFinite(code) === false) {
            throw new RangeError("code must be finite.");
        }

        Object.defineProperties(this, {
            // The standard name corresponds with values in the
            // HKEY_LOCAL_MACHINE\Software\Microsoft\Windows NT
            // \CurrentVersion\Time Zones branch of the Windows registry.
            //
            // This can be used with TimeZoneInfo.FindSystemTimeZoneById to
            // get time zone information in a C# environment.
            //
            // CRM also uses thes values to locate
            // timezonedefinition entities.  We can use this as a key value
            // to match time zone data, and to look up extended time zone
            // information (such as the offset or DST rules) from CRM.
            standardName: {
                get: function () {
                    return standardName;
                }
            },

            // CRM provides this, and we use it in the drop down.
            userInterfaceName: {
                get: function () {
                    return userInterfaceName;
                }
            },

            // CRM uses this to convert UTC times to a specific time zone.
            // Although CRM provides sufficient data that we could handle
            // this client-side, doing so seems complicated at the moment.
            code: {
                get: function () {
                    return code;
                }
            }
        });
    }

    TimeZone.prototype.equals = function (other) {
        if (other instanceof TimeZone === false) {
            return false;
        }

        return this.standardName === other.standardName;
    };

    TimeZone.getCachedValue = function (standardName) {
        return cache[standardName] || null;
    };

    TimeZone.getOrCreate = function (standardName, userInterfaceName, code) {
        if (cache.hasOwnProperty(standardName) === false) {
            cache[standardName] =
                new TimeZone(standardName, userInterfaceName, code);
        }

        return cache[standardName];
    };

    return TimeZone;
}());

/*global moment */

var ARS;
ARS = ARS || {};
ARS.Models = ARS.Models || {};
ARS.Models.WorkOrderModel = (function () {
    "use strict";

    function getterFor(context, name) {
        return function () {
            return context[name];
        };
    }

    function stringValue(context, name) {
        return {
            get: getterFor(context, name),
            set: function (value) {
                context[name] = value === null || value === undefined ?
                    null :
                    String(value).trim();
            }
        };
    }

    function WorkOrderModel() {
        var instance = {};
        instance.workOrderId        = null;
        instance.addressComposite   = null;
        instance.completeByDate     = null;
        instance.distance           = null;
        instance.isEmergency        = null;
        instance.schedulingComplete = false;
        instance.status             = null;
        instance.latLng             = null;
        instance.ticketNumber       = null;
        instance.timeZone           = null;
        instance.title              = null;
        instance.locationName       = null;
        instance.description        = null;
        instance.url                = null;
        instance.technician			= null;
        instance.po					= null;

        [
            "workOrderId", "addressComposite", "status",
            "ticketNumber", "title", "locationName", "description", "url", "po", "technician"
        ].forEach(function (key) {
            Object.defineProperty(this, key, stringValue(instance, key));
        }, this);

        Object.defineProperties(this, {
            completeByDate: {
                get: getterFor(instance, "completeByDate"),
                set: function (value) {
                    instance.completeByDate =
                        value instanceof Date ? value : null;
                }
            },
            distance: {
                get: getterFor(instance, "distance"),
                set: function (value) {
                    value = parseFloat(value);
                    instance.distance = isNaN(value) ? null : value;
                }
            },
            isEmergency: {
                get: getterFor(instance, "isEmergency"),
                set: function (value) {
                    instance.isEmergency = Boolean(value);
                }
            },
            latLng: {
                get: getterFor(instance, "latLng"),
                set: function (value) {
                    instance.latLng =
                        value instanceof ARS.Models.LatLng ? value : null;
                }
            },
            schedulingComplete: {
                get: getterFor(instance, "schedulingComplete"),
                set: function (value) {
                    instance.schedulingComplete = Boolean(value);
                }
            },
            timeZone: {
                get: getterFor(instance, "timeZone"),
                set: function (value) {
                    instance.timeZone =
                        value instanceof ARS.Models.TimeZone ? value : null;
                }
            }
        });
    }

    WorkOrderModel.prototype.equals = function (other) {
        if (other instanceof WorkOrderModel === false) {
            return false;
        }

        if (this.workOrderId === null) {
            return other.workOrderId === null;
        }

        if (other.workOrderId === null) {
            return false;
        }

        var a, b;
        a = this.workOrderId.toLowerCase();
        b = other.workOrderId.toLowerCase();

        return a === b;
    };

    WorkOrderModel.prototype.toHtml = function (template) {
        var viewModel = {};

        viewModel.workOrderId        = this.workOrderId || "";
        viewModel.addressComposite   = this.addressComposite || "";
        viewModel.status             = this.status || "";
        viewModel.schedulingComplete = this.schedulingComplete.toString();
        viewModel.ticketNumber       = this.ticketNumber || "";
        viewModel.title              = this.title || "";
        viewModel.locationName       = this.locationName || "";
        viewModel.description        = this.description || "";
        viewModel.url                = this.url || "";
        viewModel.technician		 = this.technician || "";
        viewModel.po				 = this.po || "";
        viewModel.new

        viewModel.latLng   = this.latLng ? this.latLng.toPointString() : "";
        viewModel.timeZone = this.timeZone ? this.timeZone.standardName : "";

        if (this.completeByDate !== null) {
            viewModel.completeByDateFormatted = "Complete By: ";
            viewModel.completeByDateFormatted +=
                moment(this.completeByDate).format("MM/DD/YYYY h:mm A");

            viewModel.completeByDate =
                this.completeByDate.valueOf().toString();
        } else {
            viewModel.completeByDateFormatted = "";
            viewModel.completeByDate = "";
        }

        if (this.distance !== null) {
            viewModel.distance = this.distance.toString();

            if (isFinite(this.distance)) {
                viewModel.distanceFormatted = this.distance.toFixed(1);
                viewModel.distanceFormatted +=
                    viewModel.distanceFormatted === "1.0" ? " mile" : " miles";
            } else {
                viewModel.distanceFormatted = "";
            }

        } else {
            viewModel.distance = "";
            viewModel.distanceFormatted = "";
        }

        if (this.isEmergency) {
            viewModel.isEmergency = this.isEmergency ? "true" : "false";
            viewModel.isEmergencyFormatted =
                this.isEmergency ? "emergency" : "";
        } else {
            viewModel.isEmergency = "false";
            viewModel.isEmergencyFormatted = "";
        }

        return template(viewModel);
    };

    return WorkOrderModel;
}());

var ARS;
ARS = ARS || {};
ARS.Queries = ARS.Queries || {};
ARS.Queries.CurrentUserTimeZoneQuery = (function () {
    "use strict";

    var templates = {};

    templates.fetchXml =
        "<fetch" +
        "    version=\"1.0\"" +
        "    output-format=\"xml-platform\"" +
        "    mapping=\"logical\"" +
        "    count=\"1\"" +
        "    distinct=\"true\">" +
        "    <entity name=\"timezonedefinition\">" +
        "        <attribute name=\"timezonecode\" alias=\"code\" />" +
        "        <attribute name=\"standardname\" alias=\"standardName\" />" +
        "        <attribute" +
        "            name=\"userinterfacename\"" +
        "            alias=\"userInterfaceName\" />" +
        "        <link-entity" +
        "            name=\"usersettings\"" +
        "            from=\"timezonecode\"" +
        "            to=\"timezonecode\"" +
        "            visible=\"false\">" +
        "            <filter>" +
        "                <condition" +
        "                    attribute=\"systemuserid\"" +
        "                    operator=\"eq-userid\" />" +
        "            </filter>" +
        "        </link-entity>" +
        "    </entity>" +
        "</fetch>";

    function mapResponse(response) {
        var entity;
        entity = response.entities.first();

        if (entity) {
            return ARS.Models.TimeZone.getOrCreate(
                entity.standardName,
                entity.userInterfaceName,
                entity.code
            );
        }

        return null;
    }

    function CurrentUserTimeZoneQuery() {
        return undefined;
    }

    CurrentUserTimeZoneQuery.prototype.generateFetchXml = function () {
        return templates.fetchXml;
    };

    CurrentUserTimeZoneQuery.prototype.execute = function (fetchXmlService) {
        return fetchXmlService
            .retrieveMultiple(this.generateFetchXml())
            .then(mapResponse);
    };

    return CurrentUserTimeZoneQuery;
}());

var ARS;
ARS = ARS || {};
ARS.Queries = ARS.Queries || {};
ARS.Queries.DurationQuery = (function () {
    "use strict";

    var templates;

    templates = {};

    templates.fetchXml =
        "<fetch" +
        "  version=\"1.0\"" +
        "  output-format=\"xml-platform\"" +
        "  mapping=\"logical\"" +
        "  aggregate=\"true\">" +
        "  <entity name=\"ars_servicecode\">" +
        "    <attribute" +
        "      name=\"ars_estimatedhours\"" +
        "      aggregate=\"sum\"" +
        "      alias=\"totalHours\" />" +
        "    <link-entity" +
        "      name=\"ars_incident_ars_servicecode\"" +
        "      from=\"ars_servicecodeid\"" +
        "      to=\"ars_servicecodeid\"" +
        "      visible=\"false\"" +
        "      intersect=\"true\">" +
        "      <filter>" +
        "        <condition" +
        "          attribute=\"incidentid\"" +
        "          operator=\"eq\"" +
        "          value=\"{workOrderId}\" />" +
        "      </filter>" +
        "    </link-entity>" +
        "  </entity>" +
        "</fetch>";

    function getterFor(context, name) {
        return function () {
            return context[name];
        };
    }

    function DurationQuery(workOrderId) {
        var instance = {};
        instance.workOrderId = workOrderId;

        Object.defineProperties(this, {
            workOrderId: {
                get: getterFor(instance, "workOrderId")
            }
        });
    }

    DurationQuery.prototype.generateFetchXml = function () {
        var parts;
        parts = {};
        parts.workOrderId = "{" + this.workOrderId + "}";
        return templates.fetchXml.supplant(parts);
    };

    DurationQuery.prototype.execute = function (fetchXmlService) {
        return fetchXmlService
            .retrieveMultiple(this.generateFetchXml())
            .then(function (response) {
                var entity, hasEntity, hasValue;

                hasEntity =
                    response &&
                    response.hasOwnProperty("entities") &&
                    response.entities.length > 0;

                entity = hasEntity ? response.entities[0] : null;

                hasValue =
                    hasEntity &&
                    entity.hasOwnProperty("totalHours") &&
                    typeof entity.totalHours === "number" &&
                    isNaN(entity.totalHours) === false &&
                    isFinite(entity.totalHours) === true;

                return hasValue ? entity.totalHours : null;
            });
    };

    return DurationQuery;
}());

/*global moment */

var ARS;
ARS = ARS || {};
ARS.Queries = ARS.Queries || {};
ARS.Queries.ServiceAppointmentQuery = (function () {
    "use strict";

    var templates;

    function getterFor(context, name) {
        return function () {
            return context[name];
        };
    }

    function stringValueFor(context, name) {
        return {
            get: getterFor(context, name),
            set: function (value) {
                context[name] = String(value || "").trim();
            }
        };
    }

    function extractTimeZonesByPath(response, path) {
        return response.entities.filter(function (entity) {
            return entity && entity[path] && entity[path].label;
        }).map(function (entity) {
            return entity[path].label;
        });
    }

    function extractLocationTimeZones(response) {
        return extractTimeZonesByPath(response, "location.ars_timezone");
    }

    function extractTechnicianTimeZones(response) {
        return extractTimeZonesByPath(response, "technician.ars_timezone");
    }

    function extractTimeZones(response) {
        return extractLocationTimeZones(response)
            .concat(extractTechnicianTimeZones(response))
            .distinct();
    }

    templates = {};

    templates.startsBeforeFilter =
        "<condition" +
        "  attribute=\"scheduledstart\"" +
        "  operator=\"lt\"" +
        "  value=\"{startsBefore}\" />";

    templates.endsAfterFilter =
        "<condition" +
        "  attribute=\"scheduledend\"" +
        "  operator=\"gt\"" +
        "  value=\"{endsAfter}\" />";

    templates.singleTechnicianFilter =
        "<condition" +
        "  attribute=\"ars_technician\"" +
        "  operator=\"eq\"" +
        "  value=\"{technicianId}\" />";

    templates.technicians = "<value>{technicianId}</value>";

    templates.multipleTechnicianFilter =
        "<condition attribute=\"ars_technician\" operator=\"in\">" +
        "    {technicians}" +
        "</condition>";

    templates.serviceAppointmentFilters =
        "<filter>" +
        "  {endsAfterFilter}" +
        "  {startsBeforeFilter}" +
        "  {technicianFilter}" +
        "</filter>";

    templates.fetchXml =
        "<fetch" +
        "  version=\"1.0\"" +
        "  output-format=\"xml-platform\"" +
        "  mapping=\"logical\" distinct=\"true\">" +
        "  <entity name=\"serviceappointment\">" +
        "    <attribute name=\"scheduledstart\" usertimezone=\"false\" />" +
        "    <attribute name=\"scheduledend\" usertimezone=\"false\" />" +
        "    <attribute name=\"activityid\" />" +
        "    <attribute name=\"regardingobjectid\" />" +
        "    {serviceAppointmentFilters}" +
        "    <link-entity" +
        "      name=\"ars_technician\"" +
        "      from=\"ars_technicianid\"" +
        "      to=\"ars_technician\"" +
        "      alias=\"technician\">" +
        "      <attribute name=\"ars_name\" />" +
        "      <attribute name=\"ars_technicianid\" />" +
        "      <attribute name=\"ars_latitude\" />" +
        "      <attribute name=\"ars_longitude\" />" +
        "      <attribute name=\"ars_stateprovince\" />" +
        "      <attribute name=\"ars_city\" />" +
        "      <attribute name=\"ars_streetaddress1\" />" +
        "      <attribute name=\"ars_zipcode\" />" +
        "      <attribute name=\"new_tradecopy\" />" +
        "      <attribute name=\"ars_timezone\" />" +
        "    </link-entity>" +
        "    <link-entity" +
        "      name=\"incident\"" +
        "      from=\"incidentid\"" +
        "      to=\"regardingobjectid\"" +
        "      alias=\"workOrder\">" +
        "      <attribute name=\"ticketnumber\" />" +
        "      <attribute name=\"incidentid\" />" +
        "      <attribute name=\"title\" />" +
        "      <attribute name=\"description\" />" +
        "      <attribute name=\"new_url\" />" +
        "      <attribute name=\"new_po\" />" +
        "      <attribute name=\"ars_emergencyovertimerequest\" />" +
        "      <attribute" +
        "        name=\"ars_completebydate\"" +
        "        usertimezone=\"false\" />" +
        "      <attribute name=\"statuscode\" />" +
        "      <attribute name=\"ars_schedulingcomplete\" />" +
        "      <link-entity" +
        "        name=\"account\"" +
        "        from=\"accountid\"" +
        "        to=\"customerid\"" +
        "        alias=\"account\">" +
        "        <attribute name=\"name\" />" +
        "      </link-entity>" +
        "      <link-entity" +
        "        name=\"account\"" +
        "        from=\"accountid\"" +
        "        to=\"ars_location\"" +
        "        alias=\"location\">" +
        "        <attribute name=\"name\" />" +
        "        <attribute name=\"address1_longitude\" />" +
        "        <attribute name=\"address1_latitude\" />" +
        "        <attribute name=\"address1_composite\" />" +
        "        <attribute name=\"ars_timezone\" />" +
        "      </link-entity>" +
        "    </link-entity>" +
        "  </entity>" +
        "</fetch>";

    function mapLatLng(entity, prefix) {
        var lat, lng;
        lat = entity[prefix + "latitude"];
        lng = entity[prefix + "longitude"];
        return ARS.Models.LatLng.tryCreate(lat, lng);
    }

    function mapTimeZone(entity, path, timeZones) {
        var timeZone = entity[path];
        timeZone = timeZone ? timeZone.label : null;
        return timeZones[timeZone] || null;
    }

    function mapUtcDate(date) {
        return moment.utc(date).format("YYYY-MM-DD[T]HH:mm:ss[Z]");
    }

    function mapWorkOrder(entity, timeZones) {
        var status, timeZone, workOrder;

        timeZone = mapTimeZone(entity, "location.ars_timezone", timeZones);

        status = entity["workOrder.statuscode"];
        status = status ? status.label : null;

        workOrder                  = new ARS.Models.WorkOrderModel();
        workOrder.workOrderId      = entity["workOrder.incidentid"];
        workOrder.addressComposite = entity["location.address1_composite"];
        workOrder.locationName     = entity["location.name"];
        workOrder.completeByDate   = entity["workOrder.ars_completebydate"];

        workOrder.isEmergency =
            entity["workOrder.ars_emergencyovertimerequest"];

        workOrder.latLng = mapLatLng(entity, "location.address1_");

        workOrder.schedulingComplete =
            entity["workOrder.ars_schedulingcomplete"];

        workOrder.status       = status;
        workOrder.ticketNumber = entity["workOrder.ticketnumber"];
        workOrder.timeZone     = timeZone;
        workOrder.title        = entity["workOrder.title"];
        workOrder.description  = entity["workOrder.description"];
        workOrder.title        = entity["workOrder.title"];
        workOrder.url          = entity["workOrder.new_url"];
        workOrder.technician   = entity["technician.ars_name"];
        workOrder.po		   = entity["workOrder.new_po"];

        return workOrder;
    }

    function mapTechnician(entity, timeZones) {
        var state, technician, tz;

        state = entity["technician.ars_stateprovince"];
        state = state ? state.label : null;

        tz = mapTimeZone(entity, "technician.ars_timezone", timeZones);

        technician              = new ARS.Models.Technician();
        technician.technicianId = entity["technician.ars_technicianid"];
        technician.city         = entity["technician.ars_city"];
        technician.latLng       = mapLatLng(entity, "technician.ars_");
        technician.name         = entity["technician.ars_name"];
        technician.state        = state;
        technician.street       = entity["technician.ars_streetaddress1"];
        technician.timeZone     = tz;
        technician.zip          = entity["technician.ars_zipcode"];
        technician.trade        = entity["technician.new_tradecopy"];

        return technician;
    }

    function mapToModel(entity, timeZones) {
        var appointment           = new ARS.Models.ServiceAppointment();
        appointment.utcStart      = mapUtcDate(entity.scheduledstart);
        appointment.utcEnd        = mapUtcDate(entity.scheduledend);
        appointment.appointmentId = entity.activityid;
        appointment.workOrder     = mapWorkOrder(entity, timeZones);
        appointment.technician    = mapTechnician(entity, timeZones);
        return appointment;
    }

    function getEndsAfterFilter(query) {
        var parts = {};
        parts.endsAfter = ARS.Util.xmlEncode(query.endsAfter);
        return parts.endsAfter ?
            templates.endsAfterFilter.supplant(parts) : "";
    }

    function getStartsBeforeFilter(query) {
        var parts = {};
        parts.startsBefore = ARS.Util.xmlEncode(query.startsBefore);
        return parts.startsBefore ?
            templates.startsBeforeFilter.supplant(parts) : "";
    }

    function encodeGuid(guid) {
        return ARS.Util.xmlEncode("{" + guid + "}");
    }

    function getTechnicianFilter(query) {
        var parts, techs;

        parts = {};
        techs = query.technicians;

        if (techs.length === 0) {
            return "";
        }

        if (techs.length === 1) {
            parts.technicianId = encodeGuid(techs[0].technicianId);
            return templates.singleTechnicianFilter.supplant(parts);
        }

        parts.technicians = techs.map(function (tech) {
            var part = {};
            part.technicianId = encodeGuid(tech.technicianId);
            return templates.technicians.supplant(part);
        }).join("\n");

        return templates.multipleTechnicianFilter.supplant(parts);
    }

    function getServiceAppointmentFilters(query) {
        var hasValue, parts;

        parts                    = {};
        parts.endsAfterFilter    = getEndsAfterFilter(query);
        parts.startsBeforeFilter = getStartsBeforeFilter(query);
        parts.technicianFilter   = getTechnicianFilter(query);

        hasValue =
            parts.endsAfterFilter ||
            parts.startsBeforeFilter ||
            parts.technicianFilter;

        return hasValue ?
            templates.serviceAppointmentFilters.supplant(parts) : "";
    }

    function ServiceAppointmentQuery() {
        var instance = {};
        instance.technicians = [];

        Object.defineProperties(this, {
            endsAfter: stringValueFor(instance, "endsAfter"),
            startsBefore: stringValueFor(instance, "startsBefore"),
            technicians: {
                get: function () {
                    return instance.technicians.slice(0);
                }
            }
        });

        this.clearTechnicians = function () {
            instance.technicians.length = 0;
        };

        this.addTechnician = function (technician) {
            var isValid =
                technician instanceof ARS.Models.Technician &&
                !instance.technicians.first(technician.equals, technician);

            if (isValid) {
                instance.technicians.push(technician);
            }
        };

        this.clear();
    }

    ServiceAppointmentQuery.prototype.clear = function () {
        this.endsAfter    = null;
        this.startsBefore = null;
        this.clearTechnicians();
    };

    ServiceAppointmentQuery.prototype.generateFetchXml = function () {
        var parts;
        parts = {};
        parts.serviceAppointmentFilters = getServiceAppointmentFilters(this);
        return templates.fetchXml.supplant(parts);
    };

    ServiceAppointmentQuery.prototype.execute = function (fetchXmlService) {
        return fetchXmlService
            .retrieveMultiple(this.generateFetchXml())
            .then(function (response) {
                var query = new ARS.Queries.TimeZoneQuery();

                extractTimeZones(response).forEach(query.addZone, query);

                return query
                    .execute(fetchXmlService)
                    .then(function (timeZones) {
                        return response.entities.map(function (entity) {
                            return mapToModel(entity, timeZones);
                        });
                    });
            });
    };

    return ServiceAppointmentQuery;
}());

var ARS;
ARS = ARS || {};
ARS.Queries = ARS.Queries || {};
ARS.Queries.TechnicianQuery = (function () {
    "use strict";

    var templates;

    templates = {};

    templates.regionFilter =
        "<condition" +
        "    attribute=\"ars_region\"" +
        "    operator=\"eq\"" +
        "    uiname=\"{regionName}\"" +
        "    uitype=\"ars_region\"" +
        "    value=\"{regionId}\" />";

    templates.regionFilters = "<filter type=\"or\">{regions}</filter>";

    templates.technicianIdFilter =
        "<condition" +
        "    attribute=\"ars_technicianid\"" +
        "    operator=\"eq\"" +
        "    value=\"{technicianId}\" />";

    templates.technicianFilters =
        "<filter type=\"and\">" +
        "    {regionFilters}" +
        "    {technicianIdFilter}" +
        "</filter>";

    templates.fetchXml =
        "<fetch" +
        "    version=\"1.0\"" +
        "    output-format=\"xml-platform\"" +
        "    mapping=\"logical\"" +
        "    distinct=\"true\">" +
        "    <entity name=\"ars_technician\">" +
        "        <attribute name=\"ars_name\" />" +
        "        <attribute name=\"ars_technicianid\" />" +
        "        <attribute name=\"ars_latitude\" />" +
        "        <attribute name=\"ars_longitude\" />" +
        "        <attribute name=\"ars_stateprovince\" />" +
        "        <attribute name=\"ars_city\" />" +
        "        <attribute name=\"ars_streetaddress1\" />" +
        "        <attribute name=\"ars_zipcode\" />" +
        "        <attribute name=\"ars_timezone\" />" +
        "        <attribute name=\"new_tradecopy\" />" +
        "        <order attribute=\"ars_name\" />" +
        "        {technicianFilters}" +
        "    </entity>" +
        "</fetch>";

    function getRegionFilter(region) {
        var parts = {};
        parts.regionName = ARS.Util.xmlEncode(region.regionName);
        parts.regionId = "{" + region.regionId + "}";
        parts.regionId = ARS.Util.xmlEncode(parts.regionId);
        return templates.regionFilter.supplant(parts);
    }

    function getRegionFilters(query) {
        var parts = {};
        parts.regions = query.regions.map(getRegionFilter).join("\n");
        return parts.regions ? templates.regionFilters.supplant(parts) : "";
    }

    function getTechnicianIdFilter(query) {
        var parts = {};

        if (query.technicianId) {
            parts.technicianId = "{" + query.technicianId + "}";
            parts.technicianId = ARS.Util.xmlEncode(parts.technicianId);
            return templates.technicianIdFilter.supplant(parts);
        }

        return "";
    }

    function getTechnicianFilters(query) {
        var hasValue, parts;
        parts = {};
        parts.regionFilters = getRegionFilters(query);
        parts.technicianIdFilter = getTechnicianIdFilter(query);

        hasValue = parts.regionFilters || parts.technicianIdFilter;

        return hasValue ? templates.technicianFilters.supplant(parts) : "";
    }

    function mapToModel(entity, timeZones) {
        var lat, lon, model, state, tz;

        lat = entity.ars_latitude;
        lon = entity.ars_longitude;

        state = entity.ars_stateprovince;
        state = state ? state.label : null;

        tz =
            entity &&
            entity.ars_timezone &&
            entity.ars_timezone.label &&
            timeZones.hasOwnProperty(entity.ars_timezone.label) &&
            timeZones[entity.ars_timezone.label];

        tz = tz ? timeZones[entity.ars_timezone.label] : null;

        model              = new ARS.Models.Technician();
        model.technicianId = entity.ars_technicianid;
        model.city         = entity.ars_city;
        model.latLng       = ARS.Models.LatLng.tryCreate(lat, lon);
        model.name         = entity.ars_name;
        model.state        = state;
        model.street       = entity.ars_streetaddress1;
        model.timeZone     = tz;
        model.zip          = entity.ars_zipcode;
        model.trade        = entity.new_tradecopy

        return model;
    }

    function getterFor(context, name) {
        return function () {
            return context[name];
        };
    }

    function stringValueFor(context, name) {
        return {
            get: getterFor(context, name),
            set: function (value) {
                context[name] = String(value || "").trim();
            }
        };
    }

    function TechnicianQuery() {
        var instance = {};
        instance.regions      = [];
        instance.technicianId = "";

        Object.defineProperties(this, {
            regions: {
                get: function () {
                    return instance.regions.slice(0);
                }
            },
            technicianId: stringValueFor(instance, "technicianId")
        });

        this.addRegion = function (regionId, regionName) {
            var region = {};
            region.regionId = regionId;
            region.regionName = regionName;
            instance.regions.push(region);
        };

        this.clearRegions = function () {
            instance.regions.length = 0;
        };
    }

    TechnicianQuery.prototype.reset = function () {
        this.technicianId = null;
        this.clearRegions();
    };

    TechnicianQuery.prototype.generateFetchXml = function () {
        var parts = {};
        parts.technicianFilters = getTechnicianFilters(this);
        return templates.fetchXml.supplant(parts);
    };

    TechnicianQuery.prototype.execute = function (fetchXmlService) {
        return fetchXmlService
            .retrieveMultiple(this.generateFetchXml())
            .then(function (response) {
                var query = new ARS.Queries.TimeZoneQuery();

                response.entities
                    .pluck("ars_timezone")
                    .filter(Boolean)
                    .pluck("label")
                    .filter(Boolean)
                    .distinct()
                    .forEach(query.addZone, query);

                return query
                    .execute(fetchXmlService)
                    .then(function (timeZones) {
                        return response.entities.map(function (entity) {
                            return mapToModel(entity, timeZones);
                        });
                    });
            });
    };

    return TechnicianQuery;
}());

/*global Promise */

var ARS;
ARS = ARS || {};
ARS.Queries = ARS.Queries || {};
ARS.Queries.TimeZoneQuery = (function () {
    "use strict";

    var templates = {};

    templates.timeZoneSingleFilter =
        "<condition" +
        "    attribute=\"standardname\"" +
        "    operator=\"eq\"" +
        "    value=\"{standardName}\" />";

    templates.standardNameValues = "<value>{standardName}</value>";

    templates.timeZoneMultiFilter =
        "<condition" +
        "    attribute=\"standardname\"" +
        "    operator=\"in\">" +
        "    {standardNameValues}" +
        "</condition>";

    templates.timeZoneDefinitionFilters = "<filter>{timeZoneFilter}</filter>";

    templates.fetchXml =
        "<fetch" +
        "    version=\"1.0\"" +
        "    output-format=\"xml-platform\"" +
        "    mapping=\"logical\">" +
        "    <entity name=\"timezonedefinition\">" +
        "        <attribute name=\"userinterfacename\" />" +
        "        <attribute name=\"timezonecode\" />" +
        "        <attribute name=\"standardname\" />" +
        "        {timeZoneDefinitionFilters}" +
        "    </entity>" +
        "</fetch>";

    function getSingleTimeZoneFilter(zone) {
        var parts = {};
        parts.standardName = ARS.Util.xmlEncode(zone);
        return parts.standardName ?
            templates.timeZoneSingleFilter.supplant(parts) : "";
    }

    function getMultiTimeZoneFilter(zones) {
        var parts = {};

        parts.standardNameValues = zones.map(function (zone) {
            var part = {};
            part.standardName = ARS.Util.xmlEncode(zone);
            return part.standardName ?
                templates.standardNameValues.supplant(part) : "";
        }).filter(Boolean).join("\n");

        return parts.standardNameValues ?
            templates.timeZoneMultiFilter.supplant(parts) : "";
    }

    function getTimeZoneDefinitionFilters(query) {
        var parts, zones;
        parts = {};

        zones = query.zones.filter(function (zone) {
            return ARS.Models.TimeZone.getCachedValue(zone) === null;
        });

        parts.timeZoneFilter = zones.length === 1 ?
            getSingleTimeZoneFilter(zones[0]) :
            getMultiTimeZoneFilter(zones);

        return parts.timeZoneFilter ?
            templates.timeZoneDefinitionFilters.supplant(parts) : "";
    }

    function TimeZoneQuery() {
        var instance = {};
        instance.zones = [];

        Object.defineProperties(this, {
            zones: {
                get: function () {
                    return instance.zones.slice(0);
                }
            }
        });

        this.addZone = function (zone) {
            if (zone && instance.zones.indexOf(zone) === -1) {
                instance.zones.push(zone);
            }
        };

        this.clear = function () {
            instance.zones.length = 0;
        };
    }

    TimeZoneQuery.prototype.generateFetchXml = function () {
        var parts = {};
        parts.timeZoneDefinitionFilters = getTimeZoneDefinitionFilters(this);
        return parts.timeZoneDefinitionFilters ?
            templates.fetchXml.supplant(parts) : "";
    };

    TimeZoneQuery.prototype.execute = function (fetchXmlService) {
        var timeZones, xml;

        timeZones = this.zones.reduce(function (prev, next) {
            prev[next] = ARS.Models.TimeZone.getCachedValue(next);
            return prev;
        }, {});

        xml = this.generateFetchXml();

        if (!xml) {
            return Promise.resolve(timeZones);
        }

        return fetchXmlService
            .retrieveMultiple(xml)
            .then(function (response) {
                response.entities.forEach(function (entity) {
                    var name, code, ui;
                    name = entity.standardname;
                    code = entity.timezonecode;
                    ui   = entity.userinterfacename;

                    timeZones[name] = ARS.Models.TimeZone
                        .getOrCreate(name, ui, code);
                });

                return timeZones;
            });
    };

    return TimeZoneQuery;
}());

var ARS;
ARS = ARS || {};
ARS.Queries = ARS.Queries || {};
ARS.Queries.WorkOrderQuery = (function () {
    "use strict";

    var templates;

    function sortNumeric(a, b) {
        if (a < b) {
            return -1;
        }

        if (a > b) {
            return 1;
        }

        return 0;
    }

    function mapModel(entity, timeZones) {
        var lat, lon, model, status, tz;

        lat = entity["account.address1_latitude"];
        lon = entity["account.address1_longitude"];

        tz =
            entity &&
            entity["account.ars_TimeZone"] &&
            entity["account.ars_TimeZone"].label &&
            timeZones.hasOwnProperty(entity["account.ars_TimeZone"].label) &&
            timeZones[entity["account.ars_TimeZone"].label];

        tz = tz ? timeZones[entity["account.ars_TimeZone"].label] : null;

        status = entity.statuscode ? entity.statuscode.label : null;

        model                    = new ARS.Models.WorkOrderModel();
        model.workOrderId        = entity.incidentid;
        model.addressComposite   = entity["account.address1_composite"];
        model.locationName       = entity["account.name"];
        model.completeByDate     = entity.ars_completebydate;
        model.isEmergency        = entity.ars_emergencyovertimerequest;
        model.latLng             = ARS.Models.LatLng.tryCreate(lat, lon);
        model.schedulingComplete = entity.ars_schedulingcomplete;
        model.status             = status;
        model.ticketNumber       = entity.ticketnumber;
        model.timeZone           = tz;
        model.title              = entity.title;
        model.description        = entity.description;
        model.url                = entity.new_url;
        model.technician   		 = entity["technician.ars_name"];
        model.po				 = entity.new_po;

        return model;
    }

    function mapToModel(response, timeZones) {
        var model;
        model              = {};
        model.pagingCookie = response.pagingCookie;
        model.moreRecords  = response.moreRecords;
        model.workOrders   = response.entities.map(function (entity) {
            return mapModel(entity, timeZones);
        });

        return model;
    }

    templates = {};

    templates.userFilter =
        "<condition attribute=\"ars_dispatcher\" operator=\"eq-userid\" />";

    templates.ticketFilter =
        "<condition" +
        "    attribute=\"ticketnumber\"" +
        "    operator=\"like\"" +
        "    value=\"%{value}%\" />";

    templates.singleStatusCodeFilter =
        "<condition" +
        "    attribute=\"statuscode\"" +
        "    operator=\"eq\"" +
        "    value=\"{value}\" />";

    templates.statusCodeValues = "<value>{value}</value>";

    templates.multiStatusCodesFilter =
        "<condition attribute=\"statuscode\" operator=\"in\">" +
        "    {statusCodeValues}" +
        "</condition>";

    templates.workOrderIdFilter =
        "<condition" +
        "    attribute=\"incidentid\"" +
        "    operator=\"eq\"" +
        "    value=\"{workOrderId}\" />";

    templates.schedulingCompletedFilter =
        "<condition" +
        "    attribute=\"ars_schedulingcomplete\"" +
        "    operator=\"neq\"" +
        "    value=\"1\" />";

    templates.incidentFilters =
        "<filter type=\"and\">" +
        "    {statusCodeFilter}" +
        "    {schedulingCompletedFilter}" +
        "    {userFilter}" +
        "    {ticketFilter}" +
        "    {workOrderIdFilter}" +
        "</filter>";

    templates.locationFilter =
        "<condition" +
        "    attribute=\"ars_region\"" +
        "    operator=\"eq\"" +
        "    uiname=\"{regionName}\"" +
        "    uitype=\"ars_region\"" +
        "    value=\"{regionId}\" />";

    templates.locationFilters = "<filter type=\"or\">{locations}</filter>";

    templates.fetchXml =
        "<fetch" +
        "    version=\"1.0\"" +
        "    output-format=\"xml-platform\"" +
        "    mapping=\"logical\"" +
        "    {paging}" +
        "    distinct=\"true\">" +
        "    <entity name=\"incident\">" +
        "        <attribute name=\"ticketnumber\" />" +
        "        <attribute name=\"description\" />" +
        "        <attribute name=\"new_url\" />" +
        "        <attribute name=\"new_po\" />" +
        "        <attribute name=\"incidentid\" />" +
        "        <attribute name=\"title\" />" +
        "        <attribute name=\"ars_emergencyovertimerequest\" />" +
        "        <attribute name=\"ars_completebydate\" />" +
        "        <attribute name=\"statuscode\" />" +
        "        <attribute name=\"ars_schedulingcomplete\" />" +
        "        {incidentFilters}" +
        "        <order attribute=\"ticketnumber\" />" +
        "        <link-entity" +
        "            name=\"account\"" +
        "            from=\"accountid\"" +
        "            to=\"ars_location\"" +
        "            alias=\"account\">" +
        "            <attribute name=\"address1_longitude\" />" +
        "            <attribute name=\"name\" />" +
        "            <attribute name=\"address1_latitude\" />" +
        "            <attribute name=\"address1_composite\" />" +
        "            <attribute name=\"ars_timezone\" />" +
        "            {locationFilters}" +
        "        </link-entity>" +
        "    </entity>" +
        "</fetch>";

    function getUserFilter(workOrderQuery) {
        if (workOrderQuery.allUsers === true) {
            return "";
        }

        return templates.userFilter;
    }

    function getStatusFilter(workOrderQuery) {
        var parts;

        if (workOrderQuery.statusCodes.length === 0) {
            return "";
        }

        parts = {};
        if (workOrderQuery.statusCodes.length === 1) {
            parts.value = workOrderQuery.statusCodes[0];
            return templates.singleStatusCodeFilter.supplant(parts);
        }

        parts.statusCodeValues = workOrderQuery.statusCodes
            .distinct()
            .sort(sortNumeric)
            .map(function (code) {
                return templates.statusCodeValues.supplant({ value: code });
            })
            .join("\n");

        return templates.multiStatusCodesFilter.supplant(parts);
    }

    function getTicketFilter(workOrderQuery) {
        var parts;

        parts = {};
        parts.value = workOrderQuery.ticket;

        if (!parts.value) {
            return "";
        }

        parts.value = ARS.Util.likeEncode(parts.value);
        parts.value = ARS.Util.xmlEncode(parts.value);
        return templates.ticketFilter.supplant(parts);
    }

    function getWorkOrderIdFilter(workOrderQuery) {
        var parts;

        parts = {};
        parts.workOrderId = workOrderQuery.workOrderId;

        if (!parts.workOrderId) {
            return "";
        }

        parts.workOrderId = "{" + parts.workOrderId + "}";
        parts.workOrderId = ARS.Util.xmlEncode(parts.workOrderId);
        return templates.workOrderIdFilter.supplant(parts);
    }

    function getSchedulingCompletedFilter(workOrderQuery) {
        var filter = workOrderQuery.includeCompletedSchedules;
        return filter === false ? templates.schedulingCompletedFilter : "";
    }

    function getIncidentFilters(workOrderQuery) {
        var parts, hasValue;

        parts                   = {};
        parts.statusCodeFilter  = getStatusFilter(workOrderQuery);
        parts.userFilter        = getUserFilter(workOrderQuery);
        parts.ticketFilter      = getTicketFilter(workOrderQuery);
        parts.workOrderIdFilter = getWorkOrderIdFilter(workOrderQuery);

        parts.schedulingCompletedFilter =
            getSchedulingCompletedFilter(workOrderQuery);

        hasValue =
            parts.schedulingCompletedFilter ||
            parts.statusCodeFilter ||
            parts.userFilter ||
            parts.ticketFilter ||
            parts.workOrderIdFilter;

        return hasValue ? templates.incidentFilters.supplant(parts) : "";
    }

    function getLocationFilter(region) {
        var parts = {};
        parts.regionName = ARS.Util.xmlEncode(region.regionName);
        parts.regionId = "{" + region.regionId + "}";
        parts.regionId = ARS.Util.xmlEncode(parts.regionId);
        return templates.locationFilter.supplant(parts);
    }

    function getLocationFilters(workOrderQuery) {
        var parts;

        if (workOrderQuery.regions.length === 0) {
            return "";
        }

        parts = {};
        parts.locations = workOrderQuery.regions
            .map(getLocationFilter)
            .join("\n");

        return templates.locationFilters.supplant(parts);
    }

    function getPagingAttributes(workOrderQuery) {
        var attrs, cookie;
        attrs = [];
        cookie = workOrderQuery.pagingCookie;

        if (cookie && workOrderQuery.page > 1) {
            cookie = ARS.Util.xmlEncode(cookie);
            cookie = "paging-cookie=\"" + cookie + "\"";
            attrs.push(cookie);

            attrs.push("page=\"" + workOrderQuery.page.toString() + "\"");
        }

        if (workOrderQuery.perPage < 5000) {
            attrs.push("count=\"" + workOrderQuery.perPage.toString() + "\"");
        }

        return attrs.join(" ");
    }

    function getterFor(context, name) {
        return function () {
            return context[name];
        };
    }

    function stringValueFor(context, name) {
        return {
            get: getterFor(context, name),
            set: function (value) {
                context[name] = String(value || "").trim();
            }
        };
    }

    function WorkOrderQuery() {
        var instance = {};

        instance.allUsers           = false;
        instance.page               = 1;
        instance.pagingCookie       = "";
        instance.perPage            = 20;
        instance.regions            = [];
        instance.schedulingComplete = null;
        instance.statusCodes        = [];
        instance.ticket             = "";
        instance.workOrderId        = "";

        Object.defineProperties(this, {
            allUsers: {
                get: getterFor(instance, "allUsers"),
                set: function (value) {
                    instance.allUsers = Boolean(value);
                }
            },

            page: {
                get: getterFor(instance, "page"),
                set: function (value) {
                    var parsed = parseInt(value, 10);
                    if (isNaN(parsed)) {
                        parsed = 1;
                    }

                    if (isFinite(parsed) === false) {
                        parsed = 1;
                    }

                    if (parsed < 1) {
                        parsed = 1;
                    }

                    instance.page = parsed;
                }
            },

            pagingCookie: stringValueFor(instance, "pagingCookie"),

            perPage: {
                get: getterFor(instance, "perPage"),
                set: function (value) {
                    var parsed = parseInt(value, 10);
                    if (isNaN(parsed)) {
                        parsed = 20;
                    }

                    if (isFinite(parsed) === false) {
                        parsed = 20;
                    }

                    if (parsed < 1) {
                        parsed = 1;
                    }

                    if (parsed > 5000) {
                        parsed = 5000;
                    }

                    instance.perPage = parsed;
                }
            },

            regions: {
                get: function () {
                    return instance.regions.slice(0);
                }
            },

            schedulingComplete: {
                get: getterFor(instance, "schedulingComplete"),
                set: function (value) {
                    if (value === null || value === undefined) {
                        instance.schedulingComplete = null;
                    } else {
                        instance.schedulingComplete = Boolean(value);
                    }
                }
            },

            statusCodes: {
                get: function () {
                    return instance.statusCodes.slice(0);
                }
            },

            ticket: stringValueFor(instance, "ticket"),

            workOrderId: stringValueFor(instance, "workOrderId")
        });

        this.addRegion = function (regionId, regionName) {
            var region = {};
            region.regionId = regionId;
            region.regionName = regionName;
            instance.regions.push(region);
        };

        this.clearRegions = function () {
            instance.regions.length = 0;
        };

        this.addStatusCode = function (code) {
            instance.statusCodes.push(code);
        };

        this.clearStatusCodes = function () {
            instance.statusCodes.length = 0;
        };
    }

    WorkOrderQuery.prototype.reset = function () {
        this.allUsers           = false;
        this.page               = 1;
        this.perPage            = 20;
        this.pagingCookie       = "";
        this.schedulingComplete = null;
        this.ticket             = "";
        this.workOrderId        = "";
        this.clearRegions();
        this.clearStatusCodes();
    };

    WorkOrderQuery.prototype.generateFetchXml = function () {
        var parts;
        parts = {};
        parts.incidentFilters = getIncidentFilters(this);
        parts.locationFilters = getLocationFilters(this);
        parts.paging = getPagingAttributes(this);
        return templates.fetchXml.supplant(parts);
    };

    WorkOrderQuery.prototype.execute = function (fetchXmlService) {
        return fetchXmlService
            .retrieveMultiple(this.generateFetchXml())
            .then(function (response) {
                var query = new ARS.Queries.TimeZoneQuery();

                response.entities
                    .map(function (entity) {
                        return entity["account.ars_TimeZone"];
                    })
                    .filter(Boolean)
                    .pluck("label")
                    .filter(Boolean)
                    .distinct()
                    .forEach(query.addZone, query);

                return query
                    .execute(fetchXmlService)
                    .then(function (timeZones) {
                        return mapToModel(response, timeZones);
                    });
            });
    };

    return WorkOrderQuery;
}());

/*global $, ARS */

var ARS;
ARS = ARS || {};
ARS.SearchFilterFactory = (function () {
    "use strict";

    function Behavior(instance) {
        function bubble(ev) {
            var bubbled = new $.Event(ev);
            $(instance.self).triggerHandler(bubbled);
        }

        this.attach = function () {
            $(instance.allUsersFilter).on("changeAllUsers", bubble);
            $(instance.regionFilter).on("changeRegion", bubble);
            $(instance.techFilter).on("changeTechnician", bubble);
            $(instance.ticketFilter).on("changeTicket", bubble);
            $(instance.workOrderFilter).on("changeWorkOrderFilter", bubble);
        };
    }

    function createAllUsersFilter() {
        var container = $("#allUsers");
        return new ARS.Filters.AllUsersFilter(container);
    }

    function createRegionFilter(templateService) {
        var container, attribute;
        container = $("#regions");
        attribute = "ars_Region/Id";
        return new ARS.Filters
            .RegionFilter(container, attribute, templateService);
    }

    function createTechFilter(templateService) {
        var template = templateService.getTemplate("technicianTemplate");
        return new ARS.Filters.TechnicianFilter("#technicians", template);
    }

    function createTicketFilter() {
        var attribute, container;
        attribute = "TicketNumber";
        container = $("#search");
        return new ARS.Filters.TicketFilter(attribute, container);
    }

    function createWorkOrderFilter(incidentCodes) {
        var container = $(".order-filter");
        return new ARS.Filters.WorkOrderFilter(container, incidentCodes);
    }

    function SearchFilterFactory(templateService, incidentCodes) {
        if (!templateService) {
            throw new Error("'templateService' is required");
        }

        if (!incidentCodes) {
            throw new Error("'incidentCodes' is required");
        }

        var instance;
        instance = {};
        instance.allUsersFilter  = createAllUsersFilter();
        instance.behavior        = new Behavior(instance);
        instance.regionFilter    = createRegionFilter(templateService);
        instance.techFilter      = createTechFilter(templateService);
        instance.ticketFilter    = createTicketFilter();
        instance.workOrderFilter = createWorkOrderFilter(incidentCodes);
        instance.self            = this;

        this.getAllUsersFilter = function () {
            return instance.allUsersFilter;
        };

        this.getRegionFilter = function () {
            return instance.regionFilter;
        };

        this.getTechnicianFilter = function () {
            return instance.techFilter;
        };

        this.getTicketFilter = function () {
            return instance.ticketFilter;
        };

        this.getWorkOrderFilter = function () {
            return instance.workOrderFilter;
        };

        instance.behavior.attach();
    }

    Object.defineProperties(SearchFilterFactory.prototype, {
        selectedTechnicians: {
            get: function () {
                return this.getTechnicianFilter().selectedTechnicians;
            }
        }
    });

    SearchFilterFactory.prototype.clearRegions = function () {
        this.getRegionFilter().clearRegions();
    };

    SearchFilterFactory.prototype.addRegions = function (regions) {
        this.getRegionFilter().addRegions(regions);
    };

    SearchFilterFactory.prototype.selectFirstRegion = function () {
        this.getRegionFilter().selectFirst();
    };

    SearchFilterFactory.prototype.clearTechnicians = function () {
        this.getTechnicianFilter().clearTechnicians();
    };

    SearchFilterFactory.prototype.addTechnicians = function (technicians) {
        this.getTechnicianFilter().addTechnicians(technicians);
    };

    SearchFilterFactory.prototype.selectFirstTechnician = function () {
        this.getTechnicianFilter().selectFirst();
    };

    SearchFilterFactory.prototype.selectTechnicianById =
        function (technicianId) {
            return this.getTechnicianFilter()
                .selectTechnicianById(technicianId);
        };

    return SearchFilterFactory;
}());

/*global ARS, document, window */

var ARS;
ARS = ARS || {};
ARS.ServiceFactory = (function () {
    "use strict";

    var services;
    services                           = {};
    services.dataRepository            = null;
    services.fetchXmlService           = null;
    services.regionService             = null;
    services.serviceAppointmentService = null;
    services.settingsService           = null;
    services.technicianService         = null;
    services.timeService               = null;
    services.workOrderService          = null;

    function useFakes() {
        if (document.location.protocol === "file:") {
            return true;
        }

        return window.Xrm === undefined;
    }

    function ServiceFactory() {
        return undefined;
    }

    ServiceFactory.prototype.createDataRepository = function () {
        if (services.dataRepository === null) {
            services.dataRepository = useFakes() ?
                    new ARS.Fakes.FakeDataRepository() :
                    new ARS.DataRepository();
        }

        return services.dataRepository;
    };

    ServiceFactory.prototype.createFetchXmlService = function () {
        return ARS.Services.FetchXmlService;
    };

    ServiceFactory.prototype.createWorkOrderService = function () {
        var fetchXmlService, repo;
        if (services.workOrderService === null) {
            if (useFakes()) {
                services.workOrderService =
                    new ARS.Fakes.FakeWorkOrderService();
            } else {
                fetchXmlService = this.createFetchXmlService();

                repo = this.createDataRepository();
                services.workOrderService =
                    new ARS.Services.WorkOrderService(fetchXmlService, repo);
            }
        }

        return services.workOrderService;
    };

    ServiceFactory.prototype.createServiceAppointmentService = function (geo) {
        var techService;

        if (services.serviceAppointmentService === null) {
            techService = this.createTechnicianService();

            if (useFakes()) {
                services.serviceAppointmentService =
                    new ARS.Fakes.FakeServiceAppointmentService(techService);
            } else {
                services.serviceAppointmentService =
                    new ARS.Services.ServiceAppointmentService(
                        this.createDataRepository(),
                        this.createWorkOrderService(),
                        techService,
                        geo,
                        this.createFetchXmlService());
            }
        }

        return services.serviceAppointmentService;
    };

    ServiceFactory.prototype.createTechnicianService = function () {
        var fetchXmlService;

        if (services.technicianService === null) {
            if (useFakes()) {
                services.technicianService =
                    new ARS.Fakes.FakeTechnicianService();
            } else {
                fetchXmlService = this.createFetchXmlService();
                services.technicianService =
                    new ARS.Services.TechnicianService(fetchXmlService);
            }
        }

        return services.technicianService;
    };

    ServiceFactory.prototype.createRegionService = function () {
        var repo;

        if (services.regionService === null) {
            if (useFakes()) {
                services.regionService = new ARS.Fakes.FakeRegionService();
            } else {
                repo = this.createDataRepository();
                services.regionService = new ARS.Services.RegionService(repo);
            }
        }

        return services.regionService;
    };

    ServiceFactory.prototype.createTimeService = function () {
        var fetchXmlService;

        if (services.timeService === null) {
            if (useFakes()) {
                services.timeService = new ARS.Fakes.FakeTimeService();
            } else {
                fetchXmlService = this.createFetchXmlService();
                services.timeService =
                    new ARS.Services.TimeService(fetchXmlService);
            }
        }

        return services.timeService;
    };

    ServiceFactory.prototype.createSettingsService = function () {
        var repo;

        if (services.settingsService === null) {
            repo = this.createDataRepository();
            services.settingsService = new ARS.Services.SettingsService(repo);
        }

        return services.settingsService;
    };

    return new ServiceFactory();
}());

/*global $, ARS, window */
/*property
    $container, AnimationService, Services, busyCounter, console, hide,
    hideBusyAnimation, show, showBusyAnimation, warn
*/

var ARS;
ARS = ARS || {};
ARS.Services = ARS.Services || {};
ARS.Services.AnimationService = (function () {
    "use strict";

    function warning() {
        var msg;

        msg = "Busy animation has been hidden before it was shown";

        if (window.console && typeof window.console.warn === "function") {
            window.console.warn(msg);
        }
    }

    function AnimationService(container) {

        var instance = {};
        instance.$container  = $(container);
        instance.busyCounter = 0;

        this.showBusyAnimation = function () {
            instance.busyCounter += 1;
            instance.$container.show();
        };

        this.hideBusyAnimation = function (force) {
            if (force) {
                instance.busyCounter = 0;
            } else {
                if (instance.busyCounter !== 0) {
                    instance.busyCounter -= 1;
                } else {
                    warning();
                }
            }

            if (instance.busyCounter === 0) {
                instance.$container.hide();
            }
        };
    }

    return new AnimationService("#loadingDiv");
}());

/*global $, moment, Promise, Xrm */

var ARS;
ARS = ARS || {};
ARS.Services = ARS.Services || {};
ARS.Services.FetchXmlService = (function () {
    "use strict";

    var fetchXmlService, ns;

    fetchXmlService = {};

    ns = {};
    ns.a = "http://schemas.microsoft.com/xrm/2011/Contracts";
    ns.b = "http://schemas.microsoft.com/xrm/2011/Contracts/Services";
    ns.c = "http://www.w3.org/2001/XMLSchema-instance";
    ns.d = "http://schemas.xmlsoap.org/soap/envelope/";
    ns.e =
        "http://schemas.datacontract.org/2004/07/System.Collections.Generic";

    function OptionSetValue(label, value) {
        Object.defineProperties(this, {
            label: {
                get: function () {
                    return label;
                }
            },
            value: {
                get: function () {
                    return value;
                }
            }
        });
    }

    function EntityReference(value) {
        var id, logicalName;

        id = value.getElementsByTagNameNS(ns.a, "Id")[0];
        logicalName = value.getElementsByTagNameNS(ns.a, "LogicalName")[0];

        id = id ? id.textContent || null : null;
        logicalName = logicalName ? logicalName.textContent || null : null;

        Object.defineProperties(this, {
            id: {
                get: function () {
                    return id;
                }
            },
            logicalName: {
                get: function () {
                    return logicalName;
                }
            }
        });
    }

    function PartialOptionSetValue(value) {
        this.value = value;
    }

    function parseValue(value, type) {
        var isNull = value.getAttributeNS(ns.c, "nil") === "true";

        if (isNull) {
            return null;
        }

        switch (type) {
        case "a:AliasedValue":
            value = value.getElementsByTagNameNS(ns.a, "Value")[0];
            type  = value.getAttributeNS(ns.c, "type");
            return parseValue(value, type);

        case "a:EntityReference":
            return new EntityReference(value);

        case "a:OptionSetValue":
            value = value.getElementsByTagNameNS(ns.a, "Value")[0];
            value = parseValue(value, "c:int");
            return new PartialOptionSetValue(value);

        case "c:boolean":
            return value.textContent === "true";

        case "c:dateTime":
            return moment(value.textContent).toDate();

        case "c:double":
        case "c:decimal":
            return parseFloat(value.textContent);

        case "c:int":
        case "c:long":
            return parseInt(value.textContent, 10);

        case "c:guid":
        case "c:string":
            return String(value.textContent || "");

        default:
            throw new Error("Unrecognized type: " + type);
        }
    }

    function parseAttr(attr) {
        var key, type, value;
        key   = attr.getElementsByTagNameNS(ns.e, "key")[0];
        value = attr.getElementsByTagNameNS(ns.e, "value")[0];

        if (key && value) {
            key   = String(key.textContent || "");
            type  = value.getAttributeNS(ns.c, "type");
            value = parseValue(value, type);
            return { key: key, value: value };
        }

        throw new Error("Unrecognized attribute");
    }

    function parseFormatted(kvp) {
        var key, value;
        key   = kvp.getElementsByTagNameNS(ns.e, "key")[0];
        value = kvp.getElementsByTagNameNS(ns.e, "value")[0];

        if (key && value) {
            key   = String(key.textContent || "");
            value = parseValue(value, "c:string");
            return { key: key, value: value };
        }

        throw new Error("Unrecognized formatted value");
    }

    function parseKeyValuePairs(entity, tagName, pairName, parseFn) {
        var pairs = entity.getElementsByTagNameNS(ns. a, tagName);

        if (!pairs[0]) {
            return {};
        }

        pairs = pairs[0].getElementsByTagNameNS(ns.a, pairName);

        return $.makeArray(pairs).reduce(function (prev, next) {
            var attr = parseFn(next);
            prev[attr.key] = attr.value;
            return prev;
        }, {});
    }

    function parseAttributePairs(entity) {
        var pairName, parseFn, tagName;
        tagName  = "Attributes";
        pairName = "KeyValuePairOfstringanyType";
        parseFn  = parseAttr;
        return parseKeyValuePairs(entity, tagName, pairName, parseFn);
    }

    function parseFormattedValuePairs(entity) {
        var pairName, parseFn, tagName;
        tagName  = "FormattedValues";
        pairName = "KeyValuePairOfstringstring";
        parseFn  = parseFormatted;
        return parseKeyValuePairs(entity, tagName, pairName, parseFn);
    }

    function parseEntity(entity) {
        var attrs, formatted;

        attrs     = parseAttributePairs(entity);
        formatted = parseFormattedValuePairs(entity);

        Object.keys(attrs).filter(function (key) {
            return attrs[key] instanceof PartialOptionSetValue;
        }).forEach(function (key) {
            var label, value;
            value = attrs[key].value;
            label = formatted.hasOwnProperty(key) ? formatted[key] : null;
            attrs[key] = new OptionSetValue(label, value);
        });

        return attrs;
    }

    function parseBool(node) {
        var parsed = node ? node.textContent : "false";
        return String(parsed || "").trim() === "true";
    }

    function parsePagingCookie(doc) {
        var cookie = doc.getElementsByTagNameNS(ns.a, "PagingCookie")[0];

        if (!cookie) {
            return null;
        }

        if (cookie.getAttributeNS(ns.c, "nil") === "true") {
            return null;
        }

        return String(cookie.textContent || "").trim();
    }

    function parseDocument(doc) {
        var result = {};

        result.entities = doc.getElementsByTagNameNS(ns.a, "Entity");
        result.entities = $.makeArray(result.entities).map(parseEntity);

        result.entityName = doc.getElementsByTagNameNS(ns.a, "EntityName")[0];
        result.entityName =
            result.entityName ? result.entityName.textContent : null;

        result.moreRecords =
            doc.getElementsByTagNameNS(ns.a, "MoreRecords")[0];

        result.moreRecords = parseBool(result.moreRecords);

        result.pagingCookie = parsePagingCookie(doc);

        result.totalRecordCountLimitExceeded =
            doc.getElementsByTagNameNS(ns.a, "TotalRecordCountLimitExceeded");

        result.totalRecordCountLimitExceeded =
            parseBool(result.totalRecordCountLimitExceeded[0]);

        result.totalRecordCount =
            doc.getElementsByTagNameNS(ns.a, "TotalRecordCount")[0];

        result.totalRecordCount = result.totalRecordCount ?
            parseInt(result.totalRecordCount.textContent, 10) : null;

        if (isNaN(result.totalRecordCount)) {
            result.totalRecordCount = null;
        }

        return result;
    }

    fetchXmlService.request = function (action, data) {
        var settings = {};
        settings.data               = data;
        settings.dataType           = "xml";
        settings.method             = "POST";
        settings.processData        = false;

        // ReSharper disable once UndeclaredGlobalVariableUsing
        // The Xrm variable is not available at parse time.
        settings.url                = Xrm.Page.context.getClientUrl();
        settings.url               += "/XRMServices/2011/Organization.svc/web";

        settings.contentType        = "text/xml; charset=utf-8";
        settings.headers            = {};
        settings.headers.SOAPAction = action;
        return Promise.resolve($.ajax(settings));
    };

    fetchXmlService.retrieveMultiple = function (fetchXml) {
        var action, request;

        request =
            "<d:Envelope" +
            "  xmlns:d=\"{d}\"" +
            "  xmlns:a=\"{a}\"" +
            "  xmlns:c=\"{c}\"" +
            "  xmlns:b=\"{b}\">" +
            "  <d:Header>" +
            "    <a:SdkClientVersion>6.0</a:SdkClientVersion>" +
            "  </d:Header>" +
            "  <d:Body>" +
            "    <b:RetrieveMultiple>" +
            "      <b:query c:type=\"a:FetchExpression\">" +
            "        <a:Query>{fetchXml}</a:Query>" +
            "      </b:query>" +
            "    </b:RetrieveMultiple>" +
            "  </d:Body>" +
            "</d:Envelope>";

        request = request.supplant(ns);

        // XML Encoding something that is already valid XML... *facepalm*
        request = request.supplant({
            fetchXml: ARS.Util.xmlEncode(fetchXml)
        });

        action =
            "http://schemas.microsoft.com" +
            "/xrm/2011/Contracts/Services" +
            "/IOrganizationService/RetrieveMultiple";

        return fetchXmlService.request(action, request).then(parseDocument);
    };

    fetchXmlService.OptionSetValue = OptionSetValue;

    return fetchXmlService;
}());

/*global $, ARS, Promise, window */

var ARS;
ARS = ARS || {};
ARS.Services = ARS.Services || {};
ARS.Services.GeoLocationService = (function () {
    "use strict";
    /*jslint unparam: true */

    var drivingDistanceCache;
    drivingDistanceCache = {};

    function logWarning(message) {
        if (window.console && typeof window.console.warn === "function") {
            window.console.warn(message);
        }
    }

    function WorkOrderLocationGrouping(latLng) {
        this.latLng     = latLng || null;
        this.workOrders = [];
        this.distance   = Infinity;
    }

    WorkOrderLocationGrouping.prototype.accept = function (workOrder) {
        var isMatch = false;

        if (workOrder) {
            isMatch =
                (this.latLng === null && workOrder.latLng === null) ||
                (this.latLng !== null && this.latLng.equals(workOrder));

            if (isMatch) {
                this.workOrders.push(workOrder);
            }
        }

        return isMatch;
    };

    WorkOrderLocationGrouping.createGrouping = function (workOrders) {
        return workOrders.reduce(function (prev, next) {
            var grouping, matched;

            matched = prev.some(function (g) {
                return g.accept(next);
            });

            if (matched !== true) {
                grouping = new WorkOrderLocationGrouping(next.latLng);
                grouping.workOrders.push(next);
                prev.push(grouping);
            }

            return prev;
        }, []);
    };

    function drivingResponse(resolve, ignore, from, to) {
        return function (data) {
            var result, hasDistance, msg;

            hasDistance =
                data &&
                data.resourceSets &&
                data.resourceSets[0] &&
                data.resourceSets[0].resources &&
                data.resourceSets[0].resources[0] &&
                data.resourceSets[0].resources[0].travelDistance;

            if (hasDistance) {
                result = data.resourceSets[0].resources[0].travelDistance;
                resolve(result);
            } else {
                msg = "Cannot find directions between '{0}' and '{1}'.";
                msg = msg.supplant([ from, to ]);
                logWarning(msg);
                resolve(Infinity);
            }
        };
    }

    function handleError(reject) {
        return function (request, textStatus, errorThrown) {
            logWarning("Provider error", request, textStatus, errorThrown);
            reject(new Error("BingProvider: " + errorThrown));
        };
    }

    function getDrivingDistance(bingMapsKey, fromLatLng, toLatLng) {
        function toWaypoint(c) {
            var template = "{0},{1}";
            return template.supplant([ c.getLatitude(), c.getLongitude() ]);
        }

        var valid =
            fromLatLng instanceof ARS.Models.LatLng &&
            toLatLng instanceof ARS.Models.LatLng;

        if (!valid) {
            return Promise.reject(new Error("Invalid arguments"));
        }

        if (fromLatLng.equals(toLatLng)) {
            return Promise.resolve(0);
        }

        return new Promise(function (resolve, reject) {
            var options, from, to;

            from = toWaypoint(fromLatLng);
            to   = toWaypoint(toLatLng);

            options          = {};
            options.dataType = "jsonp";
            options.jsonp    = "jsonp";

            options.data               = {};
            options.data.key           = bingMapsKey;
            options.data["waypoint.0"] = from;
            options.data["waypoint.1"] = to;
            options.data.du            = "mi"; // mi stands for miles

            options.url = window.location.protocol === "file:" ?
                    "http:" :
                    window.location.protocol;

            options.url += "//dev.virtualearth.net/REST/v1/Routes/Driving";

            options.success = drivingResponse(resolve, reject, from, to);
            options.error = handleError(reject);

            $.ajax(options);
        });
    }

    function GeoLocationService(bingMapsKey) {
        if (!bingMapsKey) {
            throw new Error("Missing parameter: bingMapsKey");
        }

        this.bingMapsKey = bingMapsKey;
    }

    GeoLocationService.prototype.getDrivingDistanceAsync =
        function (fromLatLng, toLatLng) {
            var bingMapsKey, key, match, valid;

            valid =
                fromLatLng instanceof ARS.Models.LatLng &&
                toLatLng instanceof ARS.Models.LatLng;

            if (!valid) {
                return Promise.reject(new Error("Invalid arguments"));
            }

            bingMapsKey = this.bingMapsKey;

            key = [ fromLatLng.toString(), toLatLng.toString() ];
            key = key.join(", ");

            match = drivingDistanceCache[key];

            if (!match) {
                match = getDrivingDistance(bingMapsKey, fromLatLng, toLatLng);
                drivingDistanceCache[key] = match;
            }

            return match;
        };

    GeoLocationService.prototype.getWorkOrderDistancesAsync =
        function (techLatLng, workOrders) {

            if (techLatLng instanceof ARS.Models.LatLng === false) {
                throw new TypeError("Expecting tech coordinates.");
            }

            function flattenResults(results) {
                return results.reduce(function (prev, next) {
                    return prev.concat(next.workOrders.map(function (wo) {
                        wo.distance = next.distance;
                        return wo;
                    }));
                }, []);
            }

            var promises = WorkOrderLocationGrouping
                .createGrouping(workOrders)
                .map(function (grouping) {

                    if (grouping.latLng === null) {
                        return Promise.resolve(grouping);
                    }

                    return this
                        .getDrivingDistanceAsync(techLatLng, grouping.latLng)
                        .then(function (distance) {
                            grouping.distance = distance;
                            return grouping;
                        });
                }, this);

            return Promise.all(promises).then(flattenResults);
        };

    return GeoLocationService;
}());

/*global $, window */

var ARS;
ARS = window.ARS || {};
ARS.Services = ARS.Services || {};
ARS.Services.HeartbeatService = (function () {
    "use strict";

    // The heartbeat service makes repeated queries to the service for the
    // status of appointments on the current schedule.
    //
    // When a technician arrives to an appointment, they are supposed to clock
    // in, setting the appointment's work order's status to "in progress."
    //
    // If an appointment's start date is in the past, and if the appointment's
    // work order's status is not "in progress," then we consider the
    // technician as being late.
    //
    // We need to update the calendar's rendering of appointments when a
    // technician is running late.
    //
    // It is possible that two technicians might be scheduled to the same
    // work order.  When the first one clocks in, the work order's status is
    // set to "in progress," so we have no way of knowing if the second
    // technician is late or not.  We have chosen to ignore this as
    // of 2015-08-18.

    function HeartbeatService() {
        var instance;
        instance         = {};
        instance.timeout = null;

        this.start = function () {
            this.stop();
            instance.timeout = window.setTimeout(this.beat.bind(this), 60000);
        };

        this.stop = function () {
            window.clearTimeout(instance.timeout);
            instance.timeout = null;
        };
    }

    HeartbeatService.prototype.beat = function () {
        var evt;
        evt = new $.Event("heartbeat");

        // Stop any other beat activity. Index is responsible for listening
        // for this event, doing the async action, and restarting
        // the heartbeat.
        this.stop();

        $(this).triggerHandler(evt);
    };

    return HeartbeatService;
}());

/*global $, ARS, Promise, window */

var ARS;
ARS = ARS || {};
ARS.Services = ARS.Services || {};
ARS.Services.NotificationService = (function () {
    "use strict";

    var config;
    config = {};
    config.displayTime = 4000;

    function logError(reason) {
        if (window.console && typeof window.console.error === "function") {
            window.console.error(reason);
        }
    }

    function logInfo(reason) {
        if (window.console && typeof window.console.log === "function") {
            window.console.log(reason);
        }
    }

    function showBoxAsync($box, $text, message) {
        return new Promise(function (resolve) {
            var asString =
                typeof message === "string" ? message :
                message instanceof Error ? message.message :
                String(message);

            $text.text(asString);

            $box.show("slow", function () {
                window.setTimeout(function () {
                    $box.hide("slow", resolve);
                }, config.displayTime);
            });
        });
    }

    function showErrorTask(message) {
        var $box, $text;
        $box  = $(".error-box");
        $text = $(".error-text");
        return function () {
            return showBoxAsync($box, $text, message);
        };
    }

    function showInfoTask(message) {
        var $box, $text;
        $box  = $(".info-box");
        $text = $(".message-text");
        return function () {
            return showBoxAsync($box, $text, message);
        };
    }

    function NotificationService() {

        var instance     = {};
        instance.current = null;
        instance.queue   = [];

        function startQueue() {
            var task;

            if (instance.current === null) {
                task = instance.queue.shift();
                if (task) {
                    instance.current = task().finally(function () {
                        instance.current = null;
                        startQueue();
                    });
                }
            }
        }

        this.showError = function (reason) {
            logError(reason);
            instance.queue.push(showErrorTask(reason));
            startQueue();
        };

        this.showNotification = function (message) {
            logInfo(message);
            instance.queue.push(showInfoTask(message));
            startQueue();
        };
    }

    return NotificationService;
}());

/*global ARS */

var ARS;
ARS = ARS || {};
ARS.Services = ARS.Services || {};
ARS.Services.RegionService = (function () {
    "use strict";

    var request = null;

    function mapViewModel(region) {
        var viewModel      = {};
        viewModel.regionId = region.ars_regionId;
        viewModel.name     = region.ars_name;
        return viewModel;
    }

    function mapResponse(response) {
        return response.map(mapViewModel);
    }

    function createRequest(dataRepository) {
        var options, type;
        type = "ars_region";
        options = "&$orderby=ars_name&$select=ars_name,ars_regionId";
        return dataRepository
            .loadMultipleRecordsAsync(type, options)
            .then(mapResponse);
    }

    function cachedRequest(dataRepository) {
        if (request === null) {
            request = createRequest(dataRepository);
        }

        return request;
    }

    function RegionService(dataRepository) {
        if (!dataRepository) {
            throw new Error("Missing parameter: dataRepository");
        }

        this.dataRepository = dataRepository;
    }

    RegionService.prototype.getRegionsAsync = function () {
        return cachedRequest(this.dataRepository);
    };

    return RegionService;
}());

/*global $, Address, ARS, Promise, moment */

var ARS;
ARS = ARS || {};
ARS.Services = ARS.Services || {};
ARS.Services.ServiceAppointmentService = (function () {
    "use strict";

    var config, servicesPromise;
    config = {};
    config.appointment = {};
    config.appointment.entityName = "ServiceAppointment";

    servicesPromise = null;

    function loadServicesAsync(dataRepository) {
        var options, type;

        if (servicesPromise === null) {
            type    = "Service";
            options = "&$select=Name,ServiceId";

            servicesPromise =
                dataRepository.loadMultipleRecordsAsync(type, options);
        }

        return servicesPromise;
    }

    function loadGeneralServiceAsync(dataRepository) {
        return loadServicesAsync(dataRepository).then(function (services) {
            var service;

            service = services.filter(function (obj) {
                return obj.Name === "General Service";
            })[0];

            if (!service) {
                service = services[0];
            }

            if (!service) {
                throw new Error("Could not load general service.");
            }

            return service;
        });
    }

    function getterFor(context, name) {
        return {
            get: function () {
                return context[name];
            }
        };
    }

    function Service(
        dataRepository,
        workOrderService,
        technicianService,
        geoLocationService,
        fetchXmlService
    ) {
        if (!dataRepository) {
            throw new Error("Missing parameter: dataRepository");
        }

        if (!workOrderService) {
            throw new Error("Missing parameter: workOrderService");
        }

        if (!technicianService) {
            throw new Error("Missing parameter: technicianService");
        }

        if (!geoLocationService) {
            throw new Error("Missing parameter: geoLocationService");
        }

        if (!fetchXmlService) {
            throw new Error("Missing parameter: fetchXmlService");
        }

        var instance = {};
        instance.dataRepository     = dataRepository;
        instance.geoLocationService = geoLocationService;
        instance.technicianService  = technicianService;
        instance.workOrderService   = workOrderService;
        instance.fetchXmlService    = fetchXmlService;

        Object.defineProperties(this, {
            dataRepository:     getterFor(instance, "dataRepository"),
            geoLocationService: getterFor(instance, "geoLocationService"),
            technicianService:  getterFor(instance, "technicianService"),
            workOrderService:   getterFor(instance, "workOrderService"),
            fetchXmlService:    getterFor(instance, "fetchXmlService")
        });
    }

    Service.prototype.getServiceAppointmentsAsync = function (filters) {
        var query = new ARS.Queries.ServiceAppointmentQuery();

        filters = filters || [];
        filters.forEach(function (filter) {
            var canApply =
                filter &&
                $.isFunction(filter.applyToServiceAppointmentQuery);

            if (canApply) {
                filter.applyToServiceAppointmentQuery(query);
            } else {
                throw new Error("Unexpected filter");
            }
        });

        return query.execute(this.fetchXmlService);
    };

    Service.prototype.createServiceAppointmentAsync =
        function (workOrder, technician, userStart, userEnd) {
            if (!workOrder) {
                throw new Error("Missing parameter: workOrder");
            }

            if (!technician) {
                throw new Error("Missing parameter: technician");
            }

            if (!userStart) {
                throw new Error("Missing parameter: userStart");
            }

            if (!userEnd) {
                throw new Error("Missing parameter: userEnd");
            }

            var record, recordType, repo;
            repo = this.dataRepository;

            userStart = moment(userStart).format("YYYY-MM-DD[T]HH:mm:ss");
            userEnd   = moment(userEnd).format("YYYY-MM-DD[T]HH:mm:ss");

            recordType = config.appointment.entityName;

            record                = {};
            record.ScheduledStart = userStart;
            record.ScheduledEnd   = userEnd;
            record.Subject        = workOrder.title;

            record.ars_Technician    = {};
            record.ars_Technician.Id = technician.technicianId;

            record.RegardingObjectId             = {};
            record.RegardingObjectId.Id          = workOrder.workOrderId;
            record.RegardingObjectId.LogicalName = "incident";

            record.ServiceId             = {};
            record.ServiceId.LogicalName = "service";

            return loadGeneralServiceAsync(repo).then(function (service) {
                record.ServiceId.Id = service.ServiceId;
                return repo.createRecordAsync(record, recordType);
            });
        };

    Service.prototype.updateServiceAppointmentAsync =
        function (appointmentId, userStart, userEnd) {
            if (!appointmentId) {
                throw new Error("Missing parameter: appointmentId");
            }

            if (!userStart && !userEnd) {
                throw new Error("Missing update parameters");
            }

            var entityName, obj;
            entityName = config.appointment.entityName;
            obj        = {};

            if (userStart) {
                obj.ScheduledStart =
                    moment(userStart).format("YYYY-MM-DD[T]HH:mm:ss");
            }

            if (userEnd) {
                obj.ScheduledEnd =
                    moment(userEnd).format("YYYY-MM-DD[T]HH:mm:ss");
            }

            return this.dataRepository
                .updateRecordAsync(appointmentId, obj, entityName);
        };

    Service.prototype.deleteServiceAppointmentAsync =
        function (appointmentId) {
            if (!appointmentId) {
                throw new Error("Missing parameter: appointmentId");
            }

            var type = config.appointment.entityName;

            return this.dataRepository.deleteRecordAsync(appointmentId, type);
        };

    Service.prototype.getServiceAppointmentsForTechnicianAsync =
        function (tech, utcTime) {
            var query = new ARS.Queries.ServiceAppointmentQuery();
            query.addTechnician(tech);
            query.endsAfter    = utcTime;
            query.startsBefore = utcTime;
            return query.execute(this.fetchXmlService);
        };

    Service.prototype.getTechnicianCoordinatesAsync =
        function (tech, utcTime) {
            return this
                .getServiceAppointmentsForTechnicianAsync(tech, utcTime)
                .then(function (appointments) {
                    var result, source;

                    source = appointments && appointments[0] ?
                            appointments[0] :
                            tech;

                    result                  = {};
                    result.addressComposite = source.addressComposite;
                    result.latLng           = source.latLng;

                    return result;
                });
        };

    Service.prototype.getTechnicianDistanceAsync =
        function (tech, utcTime, to) {
            var geo;

            if (to instanceof ARS.Models.LatLng === false) {
                throw new TypeError("Expecting ARS.Models.LatLng");
            }

            geo = this.geoLocationService;

            return this
                .getTechnicianCoordinatesAsync(tech, utcTime)
                .then(function (location) {
                    var from = location ? location.latLng : null;

                    if (from instanceof ARS.Models.LatLng) {
                        return geo.getDrivingDistanceAsync(from, to);
                    }

                    return Infinity; // I can see the universe.
                });
        };

    return Service;
}());

/*global ARS */

var ARS;
ARS = ARS || {};
ARS.Services = ARS.Services || {};
ARS.Services.SettingsService = (function () {
    "use strict";

    var bingMapsKeyPromise;
    bingMapsKeyPromise= null;

    function bingMapsResponse(settings) {
        return settings[0].ars_Value;
    }

    function SettingsService(dataRepository) {
        if (!dataRepository) {
            throw new Error("Missing parameter: dataRepository");
        }

        this.dataRepository    = dataRepository;
    }

    SettingsService.prototype.getBingMapsKeyAsync = function () {
        var options, type;

        type = "ars_arssetting";
        options =
            "$select=ars_Value&$top=1&$filter=ars_name eq 'Bing Maps Key'";

        if (bingMapsKeyPromise === null) {
            bingMapsKeyPromise = this.dataRepository
                .loadMultipleRecordsAsync(type, options)
                .then(bingMapsResponse);
        }

        return bingMapsKeyPromise;
    };

    return SettingsService;
}());

/*global $, ARS, Promise */

var ARS;
ARS = ARS || {};
ARS.Services = ARS.Services || {};
ARS.Services.TechnicianService = (function () {
    "use strict";

    var config;
    config = {};
    config.cache = {};

    function addTechToCache(tech) {
        var key = tech.technicianId;
        if (config.cache.hasOwnProperty(key) === false) {
            config.cache[key] = Promise.resolve(tech);
        }

        return tech;
    }

    function addTechsToCache(techs) {
        techs.forEach(addTechToCache);
        return techs;
    }

    function TechnicianService(fetchXmlService) {
        if (!fetchXmlService) {
            throw new Error("Missing parameter: fetchXmlService");
        }

        Object.defineProperties(this, {
            fetchXmlService: {
                get: function () {
                    return fetchXmlService;
                }
            }
        });
    }

    TechnicianService.prototype.getTechniciansAsync = function (filters) {
        var query = new ARS.Queries.TechnicianQuery();

        filters = filters || [];

        filters.forEach(function (filter) {
            if (filter && $.isFunction(filter.applyToTechnicianQuery)) {
                filter.applyToTechnicianQuery(query);
            }
        });

        return query
            .execute(this.fetchXmlService)
            .then(addTechsToCache);
    };

    return TechnicianService;
}());

/*global $, ARS */

var ARS;
ARS = ARS || {};
ARS.Services = ARS.Services || {};
ARS.Services.TemplateService = (function () {
    "use strict";

    function TemplateService() {
        return undefined;
    }

    TemplateService.prototype.getTemplate = function (templateName) {
        if (!templateName) {
            throw new Error("Missing parameter: templateName");
        }

        var html = $("#" + templateName).text();

        return function (obj) {
            var htmlClone = html.substring(0, html.length - 1);

            Object.keys(obj).forEach(function (key) {
                var re, value;
                re = new RegExp("{{" + key + "}}", "g");
                value = obj[key];
                value = value === undefined || value === null ? "" : value;
                htmlClone = htmlClone.replace(re, value);
            });

            return $(htmlClone.trim());
        };
    };

    return TemplateService;
}());

/*global ARS, Promise, Xrm, moment */

var ARS;
ARS = ARS || {};
ARS.Services = ARS.Services || {};
ARS.Services.TimeService = (function () {
    "use strict";

    var cache, currentUserTimeZone;
    cache = {};
    currentUserTimeZone = null;

    function timeConversionAsync(service, formatted, code, direction) {
        var action, ns, parts, request;

        ns = {};
        ns.a = "http://schemas.microsoft.com/xrm/2011/Contracts";

        ns.b =
            "http://schemas.datacontract.org" +
            "/2004/07/System.Collections.Generic";

        ns.c = "http://schemas.microsoft.com/xrm/2011/Contracts/Services";
        ns.d = "http://www.w3.org/2001/XMLSchema";
        ns.i = "http://www.w3.org/2001/XMLSchema-instance";
        ns.s = "http://schemas.xmlsoap.org/soap/envelope/";

        request =
            "<s:Envelope xmlns:s=\"{s}\">" +
            "  <s:Body>" +
            "    <Execute xmlns=\"{c}\" xmlns:i=\"{i}\" xmlns:d=\"{d}\">" +
            "      <request xmlns:a=\"{a}\">" +
            "        <a:Parameters xmlns:b=\"{b}\">" +
            "          <a:KeyValuePairOfstringanyType>" +
            "            <b:key>TimeZoneCode</b:key>" +
            "            <b:value i:type=\"d:int\">{code}</b:value>" +
            "          </a:KeyValuePairOfstringanyType>" +
            "          <a:KeyValuePairOfstringanyType>" +
            "            <b:key>{timeName}</b:key>" +
            "            <b:value i:type=\"d:dateTime\">{utcTime}</b:value>" +
            "          </a:KeyValuePairOfstringanyType>" +
            "        </a:Parameters>" +
            "        <a:RequestId i:nil=\"true\"/>" +
            "        <a:RequestName>{requestName}</a:RequestName>" +
            "      </request>" +
            "    </Execute>" +
            "  </s:Body>" +
            "</s:Envelope>";

        parts = {};
        parts.code = ARS.Util.xmlEncode(code.toString());
        parts.utcTime = ARS.Util.xmlEncode(formatted);
        parts.requestName = ARS.Util.xmlEncode(direction);
        parts.timeName = direction === "UtcTimeFromLocalTime" ?
            "LocalTime" : "UtcTime";

        request = request.supplant(ns);
        request = request.supplant(parts);

        action =
            "http://schemas.microsoft.com" +
            "/xrm/2011/Contracts/Services/IOrganizationService/Execute";

        return service.request(action, request).then(function (response) {
            var result;
            result = response.getElementsByTagNameNS(ns.b, "value")[0];

            if (result) {
                result = result.textContent;
                result = result || "";
                result = String(result).trim();
            } else {
                result = null;
            }

            return result;
        });
    }

    function getFromCacheOrServer(service, formatted, code, direction) {
        var key = formatted + " - " + code + " - " + direction;

        if (cache.hasOwnProperty(key) === false) {
            cache[key] =
                timeConversionAsync(service, formatted, code, direction);
        }

        return cache[key];
    }

    function TimeService(fetchXmlService) {
        if (!fetchXmlService) {
            throw new Error("Missing parameter: fetchXmlService");
        }

        Object.defineProperties(this, {
            fetchXmlService: {
                get: function () {
                    return fetchXmlService;
                }
            }
        });
    }

    TimeService.prototype.getCurrentUserTimeZoneAsync = function () {
        var query;

        if (currentUserTimeZone === null) {
            query = new ARS.Queries.CurrentUserTimeZoneQuery();
            currentUserTimeZone = query.execute(this.fetchXmlService);
        }

        return currentUserTimeZone;
    };

    TimeService.prototype.getSupportedTimeZonesAsync = function () {
        var query = new ARS.Queries.TimeZoneQuery();
        query.addZone("Eastern Standard Time");
        query.addZone("Central Standard Time");
        query.addZone("Pacific Standard Time");

        // Here we have both Mountain Standard Time and US Mountain Standard
        // Time.  These are two different time zones: one observes DST and one
        // does not.
        //
        // Most of the mountain states are on Mountain Standard Time.
        //
        // Arizona is on US Mountain Standard Time.
        //
        // The Navajo Nation (which is surprisingly large) is (mostly)
        // inside Arizona, and it is on Mountain Standard Time.
        //
        // The Hopi Nation is inside the Navajo Nation, and it is
        // on US Mountain Standard Time.
        query.addZone("Mountain Standard Time");
        query.addZone("US Mountain Standard Time");

        return query.execute(this.fetchXmlService);
    };

    TimeService.prototype.convertTimeZone = function (date, fromZone, toZone) {
        var self = this;

        if (fromZone.equals(toZone)) {
            date = moment(date).format("YYYY-MM-DD[T]HH:mm:ss");
            return Promise.resolve(date);
        }

        return self
            .utcTimeFromLocalTime(date, fromZone)
            .then(function (result) {
                return self.localTimeFromUtcTime(result, toZone);
            });
    };

    TimeService.prototype.localTimeFromUtcTime = function (date, timeZone) {
        var formatted, code, direction, service;
        formatted = moment.utc(date).format("YYYY-MM-DD[T]HH:mm:ss[Z]");
        code      = timeZone.code;
        direction = "LocalTimeFromUtcTime";
        service   = this.fetchXmlService;
        return getFromCacheOrServer(service, formatted, code, direction);
    };

    TimeService.prototype.utcTimeFromLocalTime = function (date, timeZone) {
        var formatted, code, direction, service;
        formatted = moment(date).format("YYYY-MM-DD[T]HH:mm:ss");
        code      = timeZone.code;
        direction = "UtcTimeFromLocalTime";
        service   = this.fetchXmlService;
        return getFromCacheOrServer(service, formatted, code, direction);
    };

    TimeService.prototype.setAppointmentTimeZones =
        function (appointments, timeZone) {
            var resolveTimes, times, zones;

            // Collect the time zones we care about.
            zones = appointments
                .pluck("technician")
                .concat(appointments.pluck("workOrder"))
                .filter(Boolean)
                .pluck("timeZone")
                .concat([ timeZone ])
                .filter(Boolean)
                .distinct(function (a, b) {
                    return a.equals(b);
                });

            // Collect the UTC times.
            times = appointments
                .pluck("utcStart")
                .concat(appointments.pluck("utcEnd"))
                .filter(Boolean)
                .reduce(function (prev, next) {
                    prev[next] = {};
                    return prev;
                }, {});

            // Convert UTC times to time zones in the selected time zones.
            resolveTimes = Object.keys(times).map(function (utcTime) {
                return Promise.all(zones.map(function (zone) {
                    return this
                        .localTimeFromUtcTime(utcTime, zone)
                        .then(function (localTime) {
                            times[utcTime][zone.standardName] = localTime;
                        });
                }, this));
            }, this);

            // Update the appointment's UTC times with zoned times.
            return Promise.all(resolveTimes).then(function () {
                appointments.forEach(function (appointment) {
                    zones.forEach(function (zone) {
                        var end, start;
                        start = times[appointment.utcStart][zone.standardName];
                        end   = times[appointment.utcEnd][zone.standardName];
                        appointment.addLocalSchedule(zone, start, end);
                    });
                });

                return appointments;
            });
        };

    return TimeService;
}());

/*global $, ARS, Promise */

var ARS;
ARS = ARS || {};
ARS.Services = ARS.Services || {};
ARS.Services.WorkOrderService = (function () {
    "use strict";

    var config;
    config = {};
    config.incident = {};
    config.incident.entityName = "Incident";
    config.incident.statusCodePromise = null;

    function WorkOrderService(fetchXmlService, dataRepository) {
        if (!fetchXmlService) {
            throw new Error("Missing parameter: fetchXmlService");
        }

        if (!dataRepository) {
            throw new Error("Missing parameter: dataRepository");
        }

        this.fetchXmlService = fetchXmlService;
        this.dataRepository  = dataRepository;

        this.changeStatus = function (workOrder, statusName, complete) {
            var entityName, self;
            self = this;
            entityName = config.incident.entityName;

            return this
                .getStatusCodesAsync()
                .then(function (incidentStatusCodes) {
                    var id, object, status;

                    id = workOrder.workOrderId;

                    status = incidentStatusCodes.first(function (obj) {
                        return obj.label === statusName;
                    }).value;

                    object                        = {};
                    object.StatusCode             = {};
                    object.StatusCode.Value       = status;
                    object.ars_SchedulingComplete = complete;

                    return self.dataRepository
                        .updateRecordAsync(id, object, entityName);
                })
                .then(function () {
                    workOrder.status = statusName;
                    workOrder.schedulingComplete = complete;
                });
        };
    }

    WorkOrderService.prototype.getStatusCodesAsync = function () {
        var modelType = ARS.Models.IncidentStatusCode;

        if (config.incident.statusCodePromise === null) {
            config.incident.statusCodePromise = this.dataRepository
                .getOptionsAsync("incident", "StatusCode")
                .then(function (results) {
                    return results.map(modelType.fromOptionSet);
                });
        }

        return config.incident.statusCodePromise;
    };

    WorkOrderService.prototype.getWorkOrdersAsync =
        function (filters, paging) {
            var query;
            paging             = paging || {};
            query              = new ARS.Queries.WorkOrderQuery();
            query.page         = paging.page || 1;
            query.pagingCookie = paging.cookie;
            query.perPage      = 20;

            filters = filters || [];

            filters.forEach(function (filter) {
                if (filter && $.isFunction(filter.applyToWorkOrderQuery)) {
                    filter.applyToWorkOrderQuery(query);
                }
            });

            return query.execute(this.fetchXmlService);
        };

    WorkOrderService.prototype.assignWorkOrder = function (workOrder) {
        return this.changeStatus(workOrder, "Scheduled", true);
    };

    WorkOrderService.prototype.unassignWorkOrder = function (workOrder) {
        return this.changeStatus(workOrder, "Accepted", false);
    };

    WorkOrderService.prototype.getWorkOrderDuration = function (workOrderId) {
        var query = new ARS.Queries.DurationQuery(workOrderId);

        return query.execute(this.fetchXmlService).then(function (duration) {
            // 4 === random number, generated by random dice roll.
            return duration === null ? 4 : duration;
        });
    };

    WorkOrderService.prototype.toggleCompleted = function (workOrder) {
        var completed = !workOrder.schedulingComplete;
        return this.changeStatus(workOrder, workOrder.status, completed);
    };

    return WorkOrderService;
}());

/*global $, window */
var ARS;
ARS = ARS || {};
ARS.Util = (function () {
    "use strict";

    // ReSharper disable NativeTypePrototypeExtending
    // It's fine, shhh, just sleep now, only dreams.

    // ReSharper disable once InconsistentNaming
    // Wish to match namespace name.
    var Util;

    Util = {};

    Util.xmlEncode = function (raw) {
        /// <summary>Escape a string for XML.</summary>
        /// <returns type="String" />

        return String(raw)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    };

    Util.likeEncode = function (raw) {
        return String(raw)
            .replace(/\[/g, '[[]')
            .replace(/_/g, '[_]')
            .replace(/%/g, '[%]')
            .replace(/'/g, "''");
    };

    return Util;
}());

/*global $, ARS */

var ARS;
ARS = ARS || {};
ARS.ViewFactory = (function () {
    "use strict";

    function ViewFactory() {
        return undefined;
    }

    ViewFactory.prototype.createMapView = function (
        bingMapsKey,
        geoLocationService,
        notificationService
    ) {
            if (!bingMapsKey) {
                throw new Error("Missing parameter: bingMapsKey");
            }

            if (!geoLocationService) {
                throw new Error("Missing parameter: geoLocationService");
            }

            return new ARS.Views.MapView(
                $("#map"),
                bingMapsKey,
                geoLocationService,
                notificationService
            );
        };

    ViewFactory.prototype.createCalendarView =
        function (workOrderProvider, userTimeZone, timeZones) {
            var container = $("#calendar");
            return new ARS.Views.CalendarView(
                container,
                workOrderProvider,
                userTimeZone,
                timeZones
            );
        };

    ViewFactory.prototype.createWorkOrderView = function (templateService) {
        if (!templateService) {
            throw new Error("Missing parameter: templateService");
        }

        var container = $(".list-group-item").first();

        return new ARS.Views.WorkOrderView(container, templateService);
    };

    return ViewFactory;
}());

/*global $, ARS, document, moment */

var ARS;
ARS = ARS || {};
ARS.Views = ARS.Views || {};
ARS.Views.CalendarView = (function () {
    "use strict";
    /*jslint unparam: true */

    function eventRender(instance, event, element) {
        var techs, timeZone;
        techs = instance.self.technicians;
        timeZone = instance.self.selectedTimeZone;

        ARS.Views.EventRendering.renderEvent(event, timeZone, techs, element);
    }

    function prepareTimeZoneDropdown(instance) {
        var control;

        function sortByName(a, b) {
            var x, y;
            x = a.userInterfaceName.toLowerCase();
            y = b.userInterfaceName.toLowerCase();
            return x > y ? 1 : x < y ? -1 : 0;
        }

        control = instance.timeZoneSelect;
        control.userTimeZone = instance.userTimeZone;

        Object
            .keys(instance.timeZones)
            .map(function (key) {
                return instance.timeZones[key];
            })
            .filter(Boolean)
            .sort(sortByName)
            .forEach(control.addSupportedTimeZone, control);

        control.prependTo(instance.container.find(".fc-toolbar .fc-right"));
    }

    function prepareCalendar(instance) {
        var options               = {};
        options.defaultView       = "agendaDay";
        options.dragScroll        = false;
        options.dropAccept        = ".work-order";
        options.droppable         = true;
        options.editable          = true;
        options.selectable 		  = true;
        options.eventDragStart    = instance.behavior.onInteractionStart;
        options.eventDragStop     = instance.behavior.onInteractionStop;
        options.eventDrop         = instance.behavior.onUpdateAppointment;
        options.eventReceive      = instance.behavior.onDropAppointment;
        options.eventRender       = eventRender.bind(null, instance);
        options.eventResize       = instance.behavior.onUpdateAppointment;
        options.eventResizeStart  = instance.behavior.onInteractionStart;
        options.eventResizeStop   = instance.behavior.onInteractionStop;
        //options.eventClick		  = instance.behavior.onClick;
        options.events            = [];
        options.header            = {};
        options.header.center     = "title";
        options.header.left       = "prev,next today";
        options.header.right      = "agendaWeek,agendaDay";
        options.selectableTime    = true;
        options.selectOverlap     = false;
        options.selectTime        = instance.behavior.onSelectTime;
        options.slotDuration      = "01:00:00";
        options.slotEventOverlap  = false;
        options.timezone          = "local";
        options.viewRender        = instance.behavior.onViewRender;

        instance.container.fullCalendar(options);
    }

    function Behavior(instance) {
        var firstRender = true;

        this.onInteractionStart = function (ignore, jsEvent) {
            var bubble = new $.Event(jsEvent, { type: "interactionStart" });
            $(instance.self).triggerHandler(bubble);
        };

        this.onInteractionStop = function (ignore, jsEvent) {
            var bubble = new $.Event(jsEvent, { type: "interactionStop" });
            $(instance.self).triggerHandler(bubble);
        };

        this.onUpdateAppointment = function (event, delta, ignore, jsEvent) {
            var bubble, data, props;

            props      = {};
            props.type = "updateAppointment";
            bubble     = new $.Event(jsEvent, props);
            data       = [];
            data[0]    = event.appointment;
            data[1]    = event.start.toDate();
            data[2]    = event.end.toDate();
            data[3]    = instance.self.selectedTimeZone;

            $(instance.self).triggerHandler(bubble, data);
        };

        this.onDropAppointment = function (event) {
            var bubble, data;

            bubble = new $.Event("dropAppointment");
            data = [];

            data[0] = instance.workOrderProvider
                .getWorkOrderById(event.workOrderId);

            data[1] = event.start.toDate();
            data[2] = instance.self.selectedTimeZone;

            $(instance.self).triggerHandler(bubble, data);

            if (bubble.isDefaultPrevented()) {
                instance.container.fullCalendar("removeEvents", function (e) {
                    return e === event;
                });
            }
        };

        this.onClick_ToggleComplete = function (ev) {
            // var bubble, data, props, workOrder;
            // workOrder  = $(ev.target).data("appointment-id");
            // workOrder  = instance.self.getAppointmentById(workOrder);
            // workOrder  = workOrder ? workOrder.workOrder : null;

            // if (!workOrder) {
            //     return;
            // }

            // props      = {};
            // props.type = "toggleCompleted";
            // bubble     = new $.Event(ev, props);
            // data       = [];
            // data[0]    = workOrder;
            // $(instance.self).triggerHandler(bubble, data);
        };

        this.onClick_RemoveAppointment = function (ev) {
            var appointmentId, bubble, data, props;

            appointmentId = $(ev.target).attr("data-appointment-id");
            props         = {};
            props.type    = "removeAppointment";
            bubble        = new $.Event(ev, props);
            data          = [];
            data[0]       = instance.self.getAppointmentById(appointmentId);

            $(instance.self).triggerHandler(bubble, data);
        };

        this.onClick = function (ev) {
        	var bubble, data, props, workOrder;
            workOrder  = $(ev.target).data("appointment-id");
            workOrder  = instance.self.getAppointmentById(workOrder);
            workOrder  = workOrder ? workOrder.workOrder : null;

            props      = {};
            props.type = "clickUrl";
            bubble     = new $.Event(ev, props);
            data       = [];
            data[0]    = workOrder;
            $(instance.self).triggerHandler(bubble, data);

            if(workOrder.url)
            {
            	window.open(workOrder.url, "_blank");
            }
    	};

        this.onSelectTime = function (ignore, end, jsEvent, cell) {
            instance.selectedTime = end;
            instance.container.data("selectedTime", cell);

            var bubble, props;
            props = {};
            props.type = "selectTime";
            bubble = new $.Event(jsEvent, props);

            $(instance.self).triggerHandler(bubble);
        };

        this.onViewRender = function () {
            var bubble, data;

            // This fires a render event during initialization, which we
            // want to skip.  Our initialization step includes other async
            // steps that also populate the calendar.
            if (firstRender) {
                firstRender = false;
                return;
            }

            bubble        = new $.Event("renderCalendar");
            data          = [];
            data[0]       = {};
            data[0].start = instance.self.scheduleStart;
            data[0].end   = instance.self.scheduleEnd;
            $(instance.self).triggerHandler(bubble, data);
        };

        this.onChangeTimeZone = function () {
            var val =
                instance.timeZoneSelect.selectedTimeZone ||
                instance.userTimeZone;

            if (val.equals(instance.lastSelectedTimeZone) === false) {
                instance.lastSelectedTimeZone = val;
                instance.behavior.onViewRender();
            }
        };

        this.attach = function () {
            var ev, sel, fn;
            ev = "click";
            sel = ".remove-appointment";
            fn = this.onClick_RemoveAppointment;

            $(instance.container).on(ev, sel, fn);

            sel = "[data-action='toggleComplete']";
            fn = this.onClick_ToggleComplete;
            $(instance.container).on(ev, sel, fn);

            sel = "[data-action='clickUrlIcon']";
            fn = this.onClick;
            $(instance.container).on(ev, sel, fn);

            ev = "change";
            fn = this.onChangeTimeZone;
            $(instance.timeZoneSelect).on(ev, fn);
        };
    }

    function updateTechnicianTimeZones(instance) {
        var techs = instance.events
            .pluck("appointment.technician")
            .concat(instance.technicians);

        instance.timeZoneSelect.updateTechnicianTimeZones(techs);
    }

    function CalendarView(
        container,
        workOrderProvider,
        userTimeZone,
        timeZones
    ) {
        if (!container) {
            throw new Error("Container is required");
        }

        if (!workOrderProvider) {
            throw new Error("workOrderProvider is required");
        }

        if (typeof workOrderProvider.getWorkOrderById !== "function") {
            throw new Error(
                "workOrderProvider must implement getWorkOrderById");
        }

        if (!userTimeZone) {
            throw new Error("userTimeZone is required");
        }

        if (!timeZones) {
            throw new Error("timeZones is required");
        }

        var instance                   = {};
        instance.behavior              = new Behavior(instance);
        instance.container             = $(container);
        instance.events                = [];
        instance.lastSelectedTimeZone  = null;
        instance.self                  = this;
        instance.technicians           = [];
        instance.timeZones             = timeZones;
        instance.timeZoneSelect        = new ARS.Controls.TimeZoneDropdown();
        instance.userTimeZone          = userTimeZone;
        instance.workOrderProvider     = workOrderProvider;

        Object.defineProperties(this, {
            // FullCalendar has a concept of "ambiguously-timed" moments which
            // do not make a whole lot of sense.  We need times on these
            // things. FullCalendar gives us "moment" objects, but from some
            // strange, internal, modified version of momentjs that does not
            // behave like normal momentjs.
            //
            // This code goes from FullCalendar's Moment, to a Date, to a real
            // Moment, then modifies the time, then sets future interaction to
            // treat this as UTC.
            //
            // This seems stupid, but it is FullCalendar's stupid, we are just
            // trying to convert out of it.
            scheduleStart: {
                get: function () {
                    var result = instance.container.fullCalendar("getView");
                    result = moment(result.intervalStart);
                    result = result.startOf("day");
                    return result;
                }
            },

            // I can't seem to figure out what fullCalendar is doing when it
            // tries to calculate the end interval.  In theory, this should be
            // much like the scheduleStart function, since fullCalendar
            // provides a view property called intervalEnd.  However, this
            // property seems to be off by as much as a day at a time. I don't
            // know why, and I don't have time to dig into it.
            scheduleEnd: {
                get: function () {
                    var rangeSize, result, view;

                    view = instance.container.fullCalendar("getView").name;

                    rangeSize            = {};
                    rangeSize.agendaDay  = "day";
                    rangeSize.agendaWeek = "week";
                    rangeSize            = rangeSize[view];

                    result = instance.container.fullCalendar("getView");
                    result = moment(result.intervalStart);
                    result = result.endOf(rangeSize);
                    return result;
                }
            },

            selectedTime: {
                get: function () {
                    return instance.selectedTime ||
                        instance.container.fullCalendar("getDate");
                }
            },

            selectedTimeZone: {
                get: function () {
                    var selected = instance.timeZoneSelect.selectedTimeZone;
                    return selected || instance.userTimeZone;
                }
            },

            technicians: {
                get: function () {
                    return instance.technicians.slice(0);
                },
                set: function (value) {
                    if ($.isArray(value) === false) {
                        throw new TypeError("Expecting an array.");
                    }

                    instance.technicians = value.slice(0);
                    updateTechnicianTimeZones(instance);
                }
            }
        });

        this.getAppointmentById = function (appointmentId) {
            var event;

            event = instance.events.first(function (e) {
                return e.appointment.appointmentId === appointmentId;
            });

            return event ? event.appointment : null;
        };

        this.clearAppointments = function () {
            instance.events.length = 0;
            instance.container.fullCalendar("removeEvents");
            updateTechnicianTimeZones(instance);
        };

        this.addAppointment = function (appointment) {
            var event, schedule;

            schedule = appointment.getLocalSchedule(this.selectedTimeZone);

            event               = {};
            event.appointmentId = appointment.appointmentId;
            event.start         = schedule.start;
            event.end           = schedule.end;
            // event.url 			= appointment.workOrder.url;

            // The "id" property here has special meaning to fullCalendar.
            // It is used to group various appointments together.
            event.id = appointment.appointmentId;

            event.title =
                appointment.workOrder.ticketNumber + "\r\n" +
                appointment.workOrder.locationName + "\r\n" +
                appointment.workOrder.addressComposite;

            event.appointment = appointment;

            instance.events.push(event);
            instance.container.fullCalendar("renderEvent", event);
            updateTechnicianTimeZones(instance);
        };

        prepareCalendar(instance);
        prepareTimeZoneDropdown(instance);
        ARS.Views.EventRendering.initializeTooltips(instance.container);
        instance.behavior.attach();
    }

    CalendarView.prototype.addAppointments = function (appointments) {
        appointments = appointments || [];
        appointments.forEach(this.addAppointment, this);
    };

    return CalendarView;
}());

/*global $, moment, window */

var ARS;
ARS = window.ARS || {};
ARS.Views = ARS.Views || {};
ARS.Views.EventRendering = (function () {
    "use strict";

    // ReSharper disable once InconsistentNaming
    // Name should match namespaced name.
    var EventRendering = {};

    function getTechnician(event) {
        var hasValue;

        hasValue =
            event &&
            event.appointment &&
            event.appointment.technician;

        return hasValue ? event.appointment.technician : null;
    }

    function getWorkOrder(event) {
        var hasValue;

        hasValue =
            event &&
            event.appointment &&
            event.appointment.workOrder;

        return hasValue ? event.appointment.workOrder : null;
    }

    function timeTableRow(targetZone, title, event) {
        var parts, schedule, template;

        schedule = event.appointment.getLocalSchedule(targetZone);

        template =
            "<tr>" +
            "    <th class=\"zone\">{title}:</th>" +
            "    <td class=\"start\">{start}</td>" +
            "    <td class=\"separator\">-</td>" +
            "    <td class=\"end\">{end}</td>" +
            "    <td class=\"name\">{name}</td>" +
            "</tr>";

        parts = {};
        parts.title = title.toHtmlString();
        parts.start = moment(schedule.start).format("h:mm a");
        parts.end   = moment(schedule.end).format("h:mm a");
        parts.name  = targetZone.userInterfaceName || targetZone.standardName;
        parts.name  = String(parts.name || "").toHtmlString();
        return template.supplant(parts);
    }

    function timeTableRowFor(selectedZone, item, title, event) {
        var hasValue;

        hasValue =
            item &&
            item.timeZone &&
            item.timeZone.equals(selectedZone) === false;

        if (!hasValue) {
            return "";
        }

        return timeTableRow(item.timeZone, title, event);
    }

    function techTimeTableRow(timeZone, event) {
        var item, title;
        item  = getTechnician(event);
        title = "Technician Time Zone";
        return timeTableRowFor(timeZone, item, title, event);
    }

    function workOrderTimeTableRow(timeZone, event) {
        var item, title;
        item  = getWorkOrder(event);
        title = "Location Time Zone";
        return timeTableRowFor(timeZone, item, title, event);
    }

    function renderTimeZoneTable(event, timeZone, element) {
        var parts, timeTable;

        timeTable =
            "<div class=\"timeTable\"><table>" +
            "    {techTime}" +
            "    {locationTime}" +
            "</table></div>";

        parts              = {};
        parts.techTime     = techTimeTableRow(timeZone, event);
        parts.locationTime = workOrderTimeTableRow(timeZone, event);

        if (parts.techTime || parts.locationTime) {
            timeTable = timeTable.supplant(parts);
            element.find(".fc-title").before(timeTable);
        }
    }

    function renderLateTechnician(event, element) {
        var isLate;

        isLate =
            event &&
            event.appointment &&
            event.appointment.technicianIsLate;

        if (isLate) {
            element.addClass("technicianIsLate");
        }
    }

    function renderSchedulingCompleteIcon(event, element) {
        // var completeIcon, workOrder;

        // workOrder = getWorkOrder(event);
        // if (workOrder && event && event.appointmentId) {

        //     completeIcon = workOrder.schedulingComplete ?
        //         "glyphicon glyphicon-ok" :
        //         "glyphicon glyphicon-option-horizontal";

        //     completeIcon =
        //         "<i class=\"" + completeIcon + "\" " +
        //         "data-action=\"toggleComplete\"></i>";

        //     completeIcon = $(completeIcon);
        //     completeIcon.data("appointment-id", event.appointmentId);
        //     element.find(".fc-time").append(completeIcon);
        // }
    }

    function renderClickUrl(event, element) {
        var searchIcon, workOrder;

        workOrder = getWorkOrder(event);
        if (workOrder && event && event.appointmentId) {

            searchIcon = "glyphicon glyphicon-search";

            searchIcon =
                "<i class=\"" + searchIcon + "\" " +
                "data-action=\"clickUrlIcon\"></i>";

            searchIcon = $(searchIcon);
            searchIcon.data("appointment-id", event.appointmentId);
            element.find(".fc-time").append(searchIcon);
        }
    }

    function renderRemoveIcon(event, element) {
        var remove;

        if (event.appointmentId) {

            remove = "<span class=\"remove-appointment\">&times;</span>";
            remove = $(remove);
            remove.attr("data-appointment-id", event.appointmentId);

            element.find(".fc-time").prepend(remove);
        }
    }

    function renderTechnicianData(event, techs, element) {
        var parts, tech, template;

        tech = getTechnician(event);

        parts = {};
        template =
            "<div class=\"technicianName\">" +
            "    <strong>Technician:</strong> {name}" +
            "</div>";

        if (tech && techs.length > 1) {
            parts.name = String(tech.name || "").toHtmlString();
            template = template.supplant(parts);
            element.find(".fc-title").before(template);
        }
    }

    function renderTooltip(element) {
        var contentHeight, height;

        // We only get a height later, after rendering is done.
        window.setTimeout(function () {
            contentHeight = element.find(".fc-content").height();
            height = element.height();

            // Sometimes we still don't get a height.  Not sure why.
            // The rendering is called twice, and the first time we don't
            // get a height, but the second time we do.  I dunno.
            if (contentHeight && height && contentHeight > height) {

                // Tooltips are actually handled by jquery-ui's tooltip.
                // See the "initializeTooltips" function below.
                element.attr("data-tooltip", "true");
            }
        }, 10);
    }

    EventRendering.renderEvent = function (event, timeZone, techs, element) {
        renderLateTechnician(event, element);
        renderTechnicianData(event, techs, element);
        renderTimeZoneTable(event, timeZone, element);
        renderSchedulingCompleteIcon(event, element);
        renderRemoveIcon(event, element);
        renderClickUrl(event, element);
        renderTooltip(element);
    };

    EventRendering.initializeTooltips = function (container) {
        $(container).tooltip({
            content: function () {
                return $(this)
                    .find(".fc-content")
                    .children(":not(.fc-time)")
                    .toArray()
                    .pluck("outerHTML")
                    .join("\n");
            },
            items: "a.fc-event[data-tooltip]",
            tooltipClass: "eventTooltip",
            hide: false,
            position: {
                my: "left bottom",
                at: "center top-5",
                collision: "none"
            }
        });
    };

    return EventRendering;
}());

/*global $, ARS, Microsoft, moment, Promise, window */

var ARS;
ARS = ARS || {};
ARS.Views = ARS.Views || {};
ARS.Views.MapView = (function () {
    "use strict";

    // ReSharper disable UndeclaredGlobalVariableUsing
    // The "Microsoft" variable is not available during parsing.

    var dateFormat, pinType;

    pinType             = {};
    pinType.WORKORDER   = "workOrder";
    pinType.APPOINTMENT = "appointment";
    pinType.TECHNICIAN  = "technician";

    dateFormat = "MMM Do YYYY, h:mm a";

    function logWarning(message) {
        if (window.console && typeof window.console.warn === "function") {
            window.console.warn(message);
        }
    }

    function getPinBounds(mapView) {
        var locations = mapView.pins
            .pluck("latLng")
            .execute("toMicrosoftLatLng");

        return locations.length > 0 ?
            Microsoft.Maps.LocationRect.fromLocations(locations) : null;
    }

    function createDescription(obj) {
        var description, lines;

        lines = Object.keys(obj).filter(function (key) {
            return obj[key];
        }).map(function (key) {
            return key + ": " + obj[key];
        });

        description = "<div class=\"infobox-body\">{0}</div>";
        return description.supplant([ lines.join("<br />") ]);
    }

    function removePushpin(instance, pin) {
        var i, pushpin;

        for (i = instance.dataLayer.getLength() - 1; i >= 0; i -= 1) {
            pushpin = instance.dataLayer.get(i);

            if (pushpin === pin.mapPin) {
                instance.dataLayer.removeAt(i);
            }
        }

        instance.pins.remove(pin);
    }

    function clearByPinType(mapView, type) {
        mapView.pins.filter(function (pin) {
            return pin.type === type;
        }).forEach(removePushpin.bind(null, mapView));
    }

    function pushWorkOrder(instance, workOrder) {
        var coords, id, info, valid;

        valid = workOrder && workOrder.latLng instanceof ARS.Models.LatLng;

        if (!valid) {
            return false;
        }

        info                = {};
        info.Address        = workOrder.addressComposite;
        info["Ticket #"]    = workOrder.ticketNumber;
        info["Complete By"] =
            moment(workOrder.completeByDate).format(dateFormat);

        coords = workOrder.latLng;
        id     = workOrder.workOrderId;

        instance.drawPushPin(coords, id, pinType.WORKORDER, info);
        return true;
    }

    function pushTechnician(instance, technician) {
        var id, infoBlock, latLng, type, valid;

        valid = technician && technician.latLng instanceof ARS.Models.LatLng;

        if (!valid) {
            return false;
        }

        id     = technician.technicianId;
        latLng = technician.latLng;
        type   = pinType.TECHNICIAN;

        infoBlock         = {};
        infoBlock.Name    = technician.name;
        infoBlock.Address = technician.addressComposite;

        instance.drawPushPin(latLng, id, type, infoBlock);
        return true;
    }

    function pushAppointment(instance, appointment) {
        var id, infoBlock, latLng, type, valid;

        valid =
            appointment &&
            appointment.workOrder &&
            appointment.workOrder.latLng instanceof ARS.Models.LatLng;

        if (!valid) {
            return false;
        }

        latLng    = appointment.workOrder.latLng;
        id        = appointment.appointmentId;
        type      = pinType.APPOINTMENT;
        infoBlock = {};

        infoBlock["Ticket #"] = appointment.workOrder.ticketNumber;
        infoBlock.Address     = appointment.workOrder.addressComposite;

        infoBlock.Start = moment(appointment.start)
            .format("MMM Do YYYY, h:mm a");

        infoBlock.End = moment(appointment.end)
            .format("MMM Do YYYY, h:mm a");

        instance.drawPushPin(latLng, id, type, infoBlock);
        return true;
    }

    function tryAddPins(mapView, addFn, pins) {
        var unplottable, warning;

        unplottable = pins.filter(function (pin) {
            return addFn(mapView, pin) === false;
        });

        if (unplottable.length) {
            warning = unplottable.length === 1 ?
                    "Ignored {0} unplottable item." :
                    "Ignored {0} unplottable items.";

            warning = warning.supplant([ unplottable.length ]);
            mapView.notificationService.showNotification(warning);
        }
    }

    function MapView(
        container,
        bingMapKey,
        geoLocationService,
        notificationService
    ) {
        if (!container) {
            throw new Error("container is required");
        }

        if (!bingMapKey) {
            throw new Error("bingMapKey is required");
        }

        if (!geoLocationService) {
            throw new Error("geoLocationService is required");
        }

        if (!window.Microsoft || !window.Microsoft.Maps) {
            throw new Error("Bing maps was not loaded");
        }

        if (!notificationService) {
            throw new Error("notificationService is required.");
        }

        this.geoLocationService = geoLocationService;
        this.notificationService = notificationService;

        this.map = new Microsoft.Maps.Map($(container)[0], {
            credentials: bingMapKey,
            zoom: 7
        });

        this.dataLayer = new Microsoft.Maps.EntityCollection();
        this.map.entities.push(this.dataLayer);

        this.infoboxLayer = new Microsoft.Maps.EntityCollection();
        this.map.entities.push(this.infoboxLayer);

        this.infobox =
            new Microsoft.Maps.Infobox(new Microsoft.Maps.Location(0, 0), {
                visible: false,
                offset:  new Microsoft.Maps.Point(0, 20),
                height:  100
            });

        this.infoboxLayer.push(this.infobox);

        this.pins = [];

        Microsoft.Maps.Events
            .addHandler(this.map, "viewchange", this.clearInfoBox.bind(this));
    }

    MapView.prototype.drawPushPin =
        function (latLng, id, type, descriptionData) {
            if (latLng instanceof ARS.Models.LatLng === false) {
                logWarning("Unplottable location.");
                return;
            }

            var location, pin, pinOptions;

            pinOptions = {};

            pin               = {};
            pin.latLng        = latLng;
            pin.type          = type;
            pin.id            = id;
            pin.description   = createDescription(descriptionData);
            this.pins.push(pin);

            switch (type) {
            case pinType.WORKORDER:
                pinOptions.icon = "images/point_red.png";
                // This icon is designed around the default values for
                // height, width, and anchor.
                pin.infoBoxHeight = 100;
                break;

            case pinType.APPOINTMENT:
                pinOptions.icon   = "images/point_green.png";
                pinOptions.height = 30;
                pinOptions.width  = 31;
                pinOptions.anchor = new Microsoft.Maps.Point(29, 29);
                pin.infoBoxHeight = 100;
                break;

            case pinType.TECHNICIAN:
                pinOptions.icon   = "images/point_blue.png";
                pinOptions.height = 33;
                pinOptions.width  = 33;
                pinOptions.anchor = new Microsoft.Maps.Point(2, 32);
                pin.infoBoxHeight = 70;
                break;
            }

            location = latLng.toMicrosoftLatLng();

            pin.mapPin =
                new Microsoft.Maps.Pushpin(location, pinOptions);

            Microsoft.Maps.Events.addHandler(
                pin.mapPin,
                "mouseover",
                this.showInfoBox.bind(this, pin)
            );

            this.dataLayer.push(pin.mapPin);
        };

    MapView.prototype.showInfoBox = function (pin) {
        this.infobox.setLocation(pin.latLng.toMicrosoftLatLng());
        this.infobox.setOptions({
            visible:     true,
            description: pin.description,
            height:      pin.infoBoxHeight
        });
    };

    MapView.prototype.clearInfoBox = function () {
        this.infobox.setOptions({ visible: false });
    };

    MapView.prototype.clearTechnicians = function () {
        clearByPinType(this, pinType.TECHNICIAN);
    };

    MapView.prototype.addTechnicians = function (technicians) {
        technicians = technicians || [];
        technicians = technicians.distinct(function (a, b) {
            return a.equals(b);
        });

        tryAddPins(this, pushTechnician, technicians);
    };

    MapView.prototype.clearWorkOrders = function () {
        clearByPinType(this, pinType.WORKORDER);
    };

    MapView.prototype.addWorkOrders = function (workOrders) {
        workOrders = workOrders || [];
        workOrders = workOrders.distinct(function (a, b) {
            return a.equals(b);
        });

        tryAddPins(this, pushWorkOrder, workOrders);
    };

    MapView.prototype.clearAppointments = function () {
        clearByPinType(this, pinType.APPOINTMENT);
    };

    MapView.prototype.addAppointments = function (appointments) {
        appointments = appointments || [];
        appointments = appointments.filter(function (appointment) {
            return Boolean(appointment.workOrder);
        }).distinct(function (a, b) {
            return a.equals(b);
        });

        tryAddPins(this, pushAppointment, appointments);
    };

    MapView.prototype.zoomToPins = function () {
        var viewOptions     = {};
        viewOptions.padding = 100;
        viewOptions.bounds  = getPinBounds(this);

        if (viewOptions.bounds) {
            this.map.setView(viewOptions);
        }
    };

    MapView.prototype.selectWorkOrder = function (workOrder) {
        var pin, workOrderId, viewOptions;

        workOrderId = workOrder ? workOrder.workOrderId : null;

        pin = this.pins.first(function (p) {
            return p.type === pinType.WORKORDER && p.id === workOrderId;
        });

        if (pin) {
            viewOptions         = {};
            viewOptions.animate = false;
            viewOptions.padding = 100;
            viewOptions.bounds  = getPinBounds(this);

            this.map.setView(viewOptions);
            this.showInfoBox(pin);
        }
    };

    return MapView;
}());

/*global $, ARS, moment */

var ARS;
ARS = ARS || {};
ARS.Views = ARS.Views || {};
ARS.Views.WorkOrderView = (function () {
    "use strict";

    var emptyFooter = $(".footer").html();

    function Behavior(instance) {

        this.attach = function () {
            var ev, sel, fn;
            ev = "click";
            sel = ".work-order";
            fn = this.onClick_WorkOrder;
            instance.$container.on(ev, sel, fn);

            fn = this.onClick_SortByTechnician;
            $("[data-action='sort-by-technician']").on(ev, fn);

            fn = this.onClick_SortByWorkOrder;
            $("[data-action='sort-by-order']").on(ev, fn);
        };

        this.onClick_SortByTechnician = function (ev) {
            var bubble = new $.Event(ev, { type: "sortByTechnician" });
            $(instance.self).triggerHandler(bubble);
        };

        this.onClick_SortByWorkOrder = function (ev) {
            var bubble = new $.Event(ev, { type: "sortByWorkOrder" });
            $(instance.self).triggerHandler(bubble);
        };

        this.onClick_WorkOrder = function (ev) {
            var bubble;

            instance.self.selectByElement(ev.target);

            bubble = new $.Event(ev, { type: "changeWorkOrder" });
            $(instance.self).triggerHandler(bubble);
        };
    }

    function mapElementToWorkOrder($element) {
        var completeByDate, latLng, model, timeZone;

        completeByDate = $element.data("work-order-complete-by-date");
        if (completeByDate) {
            completeByDate = new Date(completeByDate);
        } else {
            completeByDate = null;
        }

        latLng = $element.data("work-order-lat-lng") || "";
        latLng = ARS.Models.LatLng.tryCreate(latLng);

        timeZone = $element.data("work-order-time-zone") || "";
        timeZone =
            timeZone ? ARS.Models.TimeZone.getCachedValue(timeZone) : null;

        model = new ARS.Models.WorkOrderModel();
        model.workOrderId      = $element.data("work-order-id");
        model.addressComposite = $element.data("work-order-address");
        model.completeByDate   = completeByDate;
        model.distance         = $element.data("work-order-distance");
        model.isEmergency      = $element.data("work-order-is-emergency");
        model.latLng           = latLng;

        model.schedulingComplete =
            $element.data("work-order-scheduling-complete");

        model.status       = $element.data("work-order-status");
        model.ticketNumber = $element.data("work-order-ticket-number");
        model.title        = $element.data("work-order-title");
        model.locationName = $element.data("work-order-location-name");
        model.description  = $element.data("work-order-description");
        model.url		   = $element.data("work-order-url");
        model.technician   = $element.data("work-order-technician");
        model.po 		   = $element.data("work-order-po-number");
        model.timeZone     = timeZone;

        return model;
    }

    function addEventData(workOrder, $element) {
        // store data so the calendar knows to render an event upon drop
        var eventData = {};

        // use the element's text as the event title
        eventData.title = $.trim($element.text());

        // maintain when user navigates (see docs on the
        // renderEvent method)
        eventData.stick = true;

        eventData.workOrderId = workOrder.workOrderId;

        $element.data("event", eventData);
    }

    function makeDraggable($element, view) {
        // make the event draggable using jQuery UI
        $element.draggable({
            zIndex: 999,
            helper: "clone",
            appendTo: "body",
            revert: true,      // will cause the event to go back to its
            revertDuration: 0, // original position after the drag
            start: function (evt) {
                var bubble = new $.Event(evt, { type: "dragStart" });
                $(view).triggerHandler(bubble);
            },
            stop: function (evt) {
                var bubble = new $.Event(evt, { type: "dragStop" });
                $(view).triggerHandler(bubble);
            }
        });
    }

    function WorkOrderView(container, templateService) {
        if (!templateService) {
            throw new Error("Missing parameter: templateService");
        }

        var instance = {};
        instance.$container      = $(container);
        instance.behavior        = new Behavior(instance);
        instance.self            = this;
        instance.templateService = templateService;
        instance.page            = 0;
        instance.pagingCookie    = null;

        Object.defineProperties(this, {
            page: {
                get: function () {
                    return instance.page;
                }
            },
            pagingCookie: {
                get: function () {
                    return instance.pagingCookie;
                }
            }
        });

        this.clearSelection = function () {
            instance.$container.find(".active").removeClass("active");
            $("[data-action='sort-by-order']").prop("disabled", true);
        };

        this.selectByElement = function (element) {
            var $element = $(element).closest(".work-order");
            if ($element.parent().is(instance.$container)) {
                this.clearSelection();
                $element.addClass("active");
                $("[data-action='sort-by-order']").prop("disabled", false);
            }
        };

        this.getSelectedWorkOrder = function () {
            var $element = instance.$container.find(".active");
            return this.getWorkOrderByElement($element[0]);
        };

        this.clearWorkOrders = function () {
            instance.page = 0;
            instance.pagingCookie = null;
            instance.$container.empty();
        };

        this.addWorkOrders = function (workOrderPage) {
            var template;

            instance.page += 1;
            instance.pagingCookie = workOrderPage.pagingCookie;

            template = instance.templateService
                .getTemplate("workOrderTemplate");

            workOrderPage.workOrders.forEach(function (wo) {
                var $element;
                $element = wo.toHtml(template).appendTo(instance.$container);
                addEventData(wo, $element);
                makeDraggable($element, this);
            }, this);

            if (workOrderPage.hasMore) {
                $(".loadmore").find(".nomore").hide();
                $(".loadmore").find("img").show();
            } else {
                $(".loadmore").find(".nomore").show();
                $(".loadmore").find("img").hide();
            }
        };

        this.clearDistances = function () {
            instance.$container.find(".work-order .distance").remove();
        };

        this.getWorkOrders = function () {
            return instance.$container
                .find(".work-order")
                .toArray()
                .map(function (html) {
                    return mapElementToWorkOrder($(html));
                });
        };

        this.showWorkOrderDetails = function (workOrder) {
            $(".footer").empty();

            var template = instance.templateService
                .getTemplate("workOrderDetailsTemplate");

            workOrder.toHtml(template).appendTo(".footer");
        };

        this.clearSelection();
        instance.behavior.attach();
    }

    WorkOrderView.prototype.getWorkOrderById = function (id) {
        return this.getWorkOrders().first(function (wo) {
            return wo.workOrderId === id;
        });
    };

    WorkOrderView.prototype.getWorkOrderByElement = function (el) {
        var $element;

        $element = $(el).closest(".work-order");

        if ($element.length === 0) {
            return null;
        }

        return mapElementToWorkOrder($element);
    };

    WorkOrderView.prototype.clearWorkOrderDetails = function () {
        $(".footer").html(emptyFooter);
    };

    return WorkOrderView;
}());

/*global $, ARS, Promise, Xrm */
/*property
    $element, AllUsersFilter, Event, FilterBase, Filters, allUsers,
    applyToWorkOrderQuery, attach, behavior, constructor, create, is,
    isChecked, on, onChange_Element, prototype, self, triggerHandler, type
*/

var ARS;
ARS = ARS || {};
ARS.Filters = ARS.Filters || {};
ARS.Filters.AllUsersFilter = (function () {
    "use strict";

    function Behavior(instance) {
        this.attach = function () {
            instance.$element.on("change", this.onChange_Element);
        };

        this.onChange_Element = function (e) {
            var bubbled, props;

            props = {};
            props.type = "changeAllUsers";

            bubbled = new $.Event(e, props);

            $(instance.self).triggerHandler(bubbled);
        };
    }

    function AllUsersFilter(element) {
        if (!element) {
            throw new Error("Missing parameter: element");
        }

        var instance = {};
        instance.$element = $(element);
        instance.behavior = new Behavior(instance);
        instance.self = this;

        this.isChecked = function () {
            return instance.$element.is(":checked");
        };

        instance.behavior.attach();
    }

    AllUsersFilter.prototype = Object.create(ARS.Filters.FilterBase.prototype);
    AllUsersFilter.prototype.constructor = AllUsersFilter;

    AllUsersFilter.prototype.applyToWorkOrderQuery = function (query) {
        query.allUsers = this.isChecked();
    };

    return AllUsersFilter;
}());

/*global ARS, Promise */

var ARS;
ARS = ARS || {};
ARS.Filters = ARS.Filters || {};
ARS.Filters.DateRangeFilter = (function () {
    "use strict";

    function DateRangeFilter(start, end) {
        if (!start) {
            throw new Error("Missing parameter: start");
        }

        if (!end) {
            throw new Error("Missing parameter: end");
        }

        Object.defineProperties(this, {
            start: {
                get: function () {
                    return start;
                }
            },
            end: {
                get: function () {
                    return end;
                }
            }
        });
    }

    DateRangeFilter.prototype =
        Object.create(ARS.Filters.FilterBase.prototype);

    DateRangeFilter.prototype.constructor = DateRangeFilter;

    DateRangeFilter.prototype.applyToServiceAppointmentQuery =
        function (query) {
            query.endsAfter    = this.start;
            query.startsBefore = this.end;
        };

    return DateRangeFilter;
}());

window.REMIND_AUTH_EXPIRATION=true;
window.AUTH_EXPIRATION_REMINDER_TIME_IN_SECONDS=84055;
window.AUTH_EXPIRATION_AFTER_REMINDER_IN_SECONDS=85255;
window.AUTH_EXPIRATION_LAST_UPDATE='20171010180633';
window.DIALOG_REAUTH_DESCRIPTION='Your Microsoft Dynamics 365 session is about to expire. To continue working, please sign in again.';
window.DIALOG_REAUTH_EXPIRED_DESCRIPTION='Your session has expired. Any unsaved changes have been lost.';
window.DIALOG_REAUTH_SIGNIN_BUTTON='Sign In';
window.DIALOG_REAUTH_CANCEL_BUTTON='Cancel';
window.DIALOG_REAUTH_CLOSE_BUTTON='Close';
