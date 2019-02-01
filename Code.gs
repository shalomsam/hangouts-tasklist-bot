var DEFAULT_IMAGE_URL = PropertiesService.getScriptProperties().getProperty('defaultImage');
var firebaseUrl = PropertiesService.getScriptProperties().getProperty('firebaseUrl');
var HEADER = {
  header: {
    title : 'TaskList Bot',
    subtitle : 'A Simple Task Manager',
    imageUrl : DEFAULT_IMAGE_URL
  }
};

var COMMANDS = {
  ADD: '/add',
  LIST: '/list',
  TAKE: '/take',
  DONE: '/done',
  CLEAR: '/clear'
};

var STATUSES = {
  OPEN: 'open',
  TAKEN: 'taken',
  COMPLETED: 'completed'
};

var TASK_TYPE = {
  TEXT: "Task",
  TICKET: "Task Ticket",
  CR: "Code Review",
  MR: "Merge Request",
  QA: "QA Task"
}

// Require Moment.js
var momentUrl = "https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.23.0/moment.min.js";
var moment = UrlFetchApp.fetch(momentUrl).getContentText();
eval(moment);

// Require Underscore.js
var _ = Underscore.load();


try {
  var db = FirebaseApp.getDatabaseByUrl(firebaseUrl);
} catch (e) {
  var errorMsg = "An error occurred with DB connection: " + JSON.stringify(e);
  console.log(errorMsg);
}


/**
 * Responds to a MESSAGE event in Hangouts Chat.
 *
 * @param {Object} event the event object from Hangouts Chat.
 */
function onMessage(event) {
  var userMsg = event.message.argumentText;
  bindTaskBotParams(event);

  if (userMsg.indexOf(COMMANDS.ADD) > -1) {
    return onAdd(event);
  }
  else if (userMsg.indexOf(COMMANDS.LIST) > -1) {
    return onList(event);
  }
  else if (userMsg.indexOf(COMMANDS.CLEAR) > -1) {
    return onClear(event);
  }
  else {
    return onHelp(event);
  }
}


/**
  * Responds to a ADD command in Hangouts Chat.
  *
  * @param {Object} event     - the parent event object.
  */
function onAdd(event) {
  var userMsg = event._taskListBot_.userMsg;
  var name = event.user.displayName;
  var listPath = event._taskListBot_.listPath;
  var message = "New Task added by " + name;
  var list = db.getData(listPath) || [];
  var urlRegex = /(https?:\/\/[^\s]+)/g;

  userMsg = userMsg.replace(COMMANDS.ADD, '').trim().toLowerCase();

  if (userMsg === "") {
    message = "No task specified. Please specify task description or link after 'add'";
  } else {
    var newObj = { taskType: TASK_TYPE.TEXT, task: userMsg, status: STATUSES.OPEN, createdBy: name, takenBy: '', createdOn: Date.now(), takenOn: null, completeOn: null };

    var urls = userMsg.match(urlRegex) || [];
    if (urls.length) {
      taskType = TASK_TYPE.TICKET;
      var ticketId = _.last(urls[0].split('/'));
      newObj.ticketId = ticketId;
      newObj.ticketLink = urls[0];
    }

    if (userMsg.indexOf('cr') > -1 || userMsg.indexOf('code review') > -1) {
      newObj.taskType = TASK_TYPE.CR;
    } else if (userMsg.indexOf('mr') > -1 || userMsg.indexOf('merge request') > -1) {
      newObj.taskType = TASK_TYPE.MR;
    } else if (userMsg.indexOf('qa') > -1) {
      newObj.taskType = TASK_TYPE.QA;
    }

    if (newObj.taskType !== TASK_TYPE.TEXT) {
      newObj.task = newObj.taskType + " for <a href=\"" + newObj.ticketLink + "\">" + newObj.ticketId.toUpperCase() + "</a>"
    }

    list.push(newObj);
    db.setData(listPath, list);
  }

  var response = onList(event);
  response.cards[0].header.subtitle = message;
  return response;
}

/**
  * Responds to a LIST command in Hangouts Chat.
  *
  * @param {string} userMsg   - the message input from the User.
  * @param {string} name      - the user name.
  * @param {string} listPath  - the database list path.
  * @param {Object} event     - the parent event object.
  */
function onList(event) {
  var listPath = event._taskListBot_.listPath;
  var name = event.user.displayName;
  var params = event._taskListBot_.userMsg;

  var icons = {
    open: "<font color=\"" + getStatusColor('open') + "\">&#9776;</font>",
    taken: "<font color=\"" + getStatusColor('taken') + "\">&#9775;</font>",
    completed: "<font color=\"" + getStatusColor('completed') + "\">&#9745;</font>"
  };

  var list = db.getData(listPath) || [];
  var sections = [];

  if (list.length) {

    list.forEach(function(item, i) {
      var section = {};
      var widgets = [];
      var buttonsArr = [];

      console.info("onList:list.forEach:item", item);

      var index = i.toString();

      // Task Title
      var taskTitle = icons[item.status] + " " + item.task;
      taskTitle += item.status === STATUSES.TAKEN ? " taken by <b>" + item.takenBy + "</b>" : "";
      widgets.push({
        "textParagraph": {
          "text": taskTitle
        }
      });

      // Task buttons
      if (item.status === STATUSES.OPEN) {

        buttonsArr = [
          {
            "textButton": {
              "text": 'Take',
              "onClick": {
                "action": {
                  "actionMethodName": "takeAction",
                  "parameters": [{
                    "key": "index",
                    "value": index,
                  }, {
                    "key": "takenBy",
                    "value": name
                  }, {
                    "key": "listPath",
                    "value": listPath
                  }]
                }
              }
            }
          }
        ];

      }
      else if (item.status === STATUSES.TAKEN) {

        buttonsArr = [{
          textButton: {
            text: 'Complete',
            onClick: {
              action: {
                actionMethodName: 'completeAction',
                parameters: [{
                  key: 'index',
                  value: index,
                }, {
                  key: 'completedBy',
                  value: name
                }, {
                  key: 'listPath',
                  value: listPath
                }]
              }
            }
          }
        }];

      }

      // Detailed: Task Status | Created By | Taken By
      if (_.contains(params, 'v') || _.contains(params, 'verbose') || _.contains(params, 'detailed')) {
        widgets.push(
          {
            "textParagraph": {
              "text": "<b>Status:</b> <font color=\"" + getStatusColor(item.status) + "\">" + capitalize(item.status) + "</font> | " +
                "<b>Created By:</b> " + item.createdBy +
                ( item.status === STATUSES.TAKEN ? " | <b>Taken By:</b> " + item.takenBy : "" ),
            }
          }
        );
      }

      if (buttonsArr.length > 0) {
        widgets.push({
          buttons: buttonsArr
        });
      }
      // end: Task Buttons

      section.widgets = widgets;
      sections.push(section);

    });

     console.info("onList:sections", JSON.stringify(sections, null, 2) );

  } else {
    sections.push({"widgets": [{
       "textParagraph": {
         "text": "No Tasks in list"
       }
      }]
    });
  }

  return createCardFromSections(sections);
}

/**
  * Responds to a CLEAR command in Hangouts Chat.
  *
  * @param {Object} event - the parent event object.
  */
function onClear(event) {
  var listPath = event._taskListBot_.listPath;
  var userMsg = event._taskListBot_.userMsg;

  var all = false;
  var msg = 'Are you sure you want to clear all <b>completed</b> tasks? <b>This is irreversible</b>.';

  if (userMsg.trim().toLowerCase().indexOf('all') > -1) {
    var msg = 'Are you sure you want to clear <b>ALL (completed and open)</b> tasks? <b>This is irreversible</b>.';
    all = true;
  }

  var buttonsArr = [{
    textButton: {
      text: 'Continue',
      onClick: {
        action: {
          actionMethodName: 'clearTasksAction',
          parameters: [{
            key: 'listPath',
            value: listPath
          },{
            key: 'clearAll',
            value: all
          }]
        }
      }
    }
  }];

  var sections = [
    {
      widgets: [
        {
          textParagraph: {
            text: msg
          }
        },
        {
          buttons: buttonsArr
        }
      ]
    }
  ];

  return createCardFromSections(sections);
}


/**
 * Responds to the HELP command in Hangouts Chat.
 *
 * @param {Object} event - the parent event object.
 */
function onHelp(event) {
  return {
    text: "TaskList Bot Help: \n" +
          "```\nUsage: /[command] [?options] \n" +
          "Commands: \n" +
          "\tadd [task|CR|MR|QA|LINK]\t\t: Adds a new task to " + getChatName(event) + " \n" +
          "\tlist\t\t\t\t: Lists all tasks in " + getChatName(event) + " \n" +
          "\tclear [?all]\t\t\t: Clear all completed [or all] tasks in " + getChatName(event) + "\n" +
          "```"
  };
}


// -------------- CARD CLICK ACTIONS -------------------------

/**
 * Responds to a CARD_CLICKED event triggered in Hangouts Chat.
 * @param {object} event the event object from Hangouts Chat.
 * @return {object} JSON-formatted response.
 */
function onCardClick(event) {
  var message = '';
  var params = event.action.parameters;
  params = _.pluck(params, 'value');
  params.push(event);

  if (event.action.actionMethodName == 'completeAction') {
    return completeAction.apply(null, params);
  } else if (event.action.actionMethodName == 'takeAction') {
    return takeAction.apply(null, params);
  } else if (event.action.actionMethodName == 'clearTasksAction') {
    return clearTasksAction.apply(null, params);
  } else {
    message = "I'm sorry; I'm not sure which button you clicked.";
    return { text: message };
  }
}

/**
  * Responds to a COMPLETE (card_click) action in Hangouts Chat.
  *
  * @param {integer} index    - the task index.
  * @param {string}  name     - the user name.
  * @param {string}  listPath - the database list path.
  * @param {Object}  event    - the parent event object.
  */
function completeAction(index, name, listPath, event) {
  var sections = [];
  var msg = "Task " + ( parseInt(index) + 1 ) + " <b>completed</b> by <b>" + name + "</b>";
  listPath = listPath + "/" + index;

  var current = db.getData(listPath);
  var update = { status: STATUSES.COMPLETED, completedOn: Date.now() };

  if (event.user.displayName === current.takenBy) {

    update = _.extend(current, update);
    db.setData(listPath, update);

    bindTaskBotParams(event);
    var response = onList(event);

    return {
      actionResponse: {
        type: 'UPDATE_MESSAGE'
      },
      cards: response.cards
    }

  } else {
    msg = "Task " + ( parseInt(index) + 1 ) + " taken by " + current.takenBy + " and can only be completed by the same user.";

    sections.push({"widgets":
      [{
        "textParagraph": {
          "text": msg
        }
      }]
    });

    return createCardFromSections(sections);
  }
}

/**
  * Responds to a TAKE (card_click) action in Hangouts Chat.
  *
  * @param {integer} index    - the task index.
  * @param {string}  name     - the user name.
  * @param {string}  listPath - the database list path.
  * @param {Object}  event    - the parent event object.
  */
function takeAction(index, name, listPath, event) {
  var sections = [];
  listPath = listPath + "/" + index;
  var data = db.getData(listPath);

  if (data.status === STATUSES.TAKEN) {

    var msg = "Task already taken by " + data.takenBy;
    sections.push({"widgets": [{
        "textParagraph": {
          "text": msg
        }
      }]
    });

    return createCardFromSections(sections);

  } else {
    name = event.user.displayName;
    var update = { status: STATUSES.TAKEN, takenBy: name, takenOn: Date.now() };
    update = _.extend(data, update);
    db.setData(listPath, update);

    bindTaskBotParams(event);
    var response = onList(event);

    console.info('takeAction:card:', response);

    return {
      actionResponse: {
        type: 'UPDATE_MESSAGE'
      },
      cards: response.cards
    };

  }
}

/**
  * Responds to a CLEAR TASK (card_click) action in Hangouts Chat.
  *
  * @param {string}  listPath - Database list path.
  * @param {boolean} clearAll - Clear all tasks (completed and open) when true.
  */
function clearTasksAction(listPath, clearAll) {
  var sections = [];
  var msg = "All <b>Completed</b> tasks in current list are cleared.";
  clearAll = clearAll || false;

  if (clearAll) {
    msg = "All Tasks (Open, Taken & Completed) in current list are cleared.";
    db.setData(listPath, []);
  } else {
    var list = db.getData(listPath);
    list = list.filter(function(item) {
      return item.status !== STATUSES.COMPLETED;
    });
    db.setData(listPath, list);
  }

  console.info('clearTaskAction:filter', list);

  sections.push({"widgets": [{
        "textParagraph": {
          "text": msg
        }
      }]
  });

  return createCardFromSections(sections);
}

// -------------- END: CARD CLICK ACTIONS ---------------------



/**
 * Get the Chat Room name or returns DM for Direct Messages.
 *
 * @param {Object} event - The parent event object.
 * @returns {string}
 */
function getChatName(event) {
  if (event.space.type === "DM" ) {
    return "this chat";
  } else {
    return event.space.displayName;
  }
}

/**
 * Generates the database list path for each room and DM (to create isolated lists per room/DM).
 *
 * @param {Object} event - The parent event object.
 * @returns {string}
 */
function getListPath(event) {
  var listPath = '/list';

  if (event.space.type === "DM") {
    listPath = '/' + event.user.name + '/list';
  } else {
    listPath = '/' + event.space.displayName + '/list';
  }

  return listPath;
}


/**
 * Creates a card-formatted response.
 *
 * @param {object} header   - The header component of the Card.
 * @param {object} widgets  - the UI components to send.
 * @return {object} JSON-formatted response.
 */
function createCardResponse(header, widgets) {
header = header || HEADER;
  return {
    cards: [header, {
      sections: [{
        widgets: widgets
      }]
    }]
  };
}

/**
 * Creates a card response from an array of sections.
 *
 * @param {Array} sections - Array of card sections.
 */
function createCardFromSections(sections) {
  return {
    cards: [HEADER, {
      sections: sections
    }]
  };
}

/**
 * Returns the color associated with the given status.
 *
 * @param {string} status - The Task status.
 */
function getStatusColor(status) {
  var colors = {open: "#3498db", taken: "#f1c40f", completed: "#2ecc71"};
  return colors[status.toLowerCase()];
}

/**
 * Capitalize the given text.
 *
 * @param {string} text - string phrase or word.
 */
function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.substr(1);
}

/**
 * Binds TaskList Bot specific params into the event Object.
 *
 * @param {Object} event - the event object from Hangouts Chat.
 */
function bindTaskBotParams(event) {
  var userMsg = getUserMsg(event);
  var params = userMsg.trim().split(" ");
  var listPath = getListPath(event);
  var command = params.shift();
  event._taskListBot_ = { command: command, listPath: listPath, userMsg: userMsg };
}

/**
 * Gets User's initial/original message from event object.
 *
 * @param {Object} event - the event object from Hangouts Chat.
 */
function getUserMsg(event) {
  var userMsg = "";
  if (event.hasOwnProperty('message') && event.message.hasOwnProperty('argumentText')) {
    userMsg = event.message.argumentText;
  } else if (event.hasOwnProperty('_taskListBot_')) {
    userMsg = event._taskListBot_.userMsg;
  }

  return userMsg;
}

/**
 * Responds to an ADDED_TO_SPACE event in Hangouts Chat.
 *
 * @param {Object} event the event object from Hangouts Chat.
 */
function onAddToSpace(event) {
  var message = "";

  if (event.space.type == "DM") {
    message = "Thank you for adding me to a DM, " + event.user.displayName + "!";
  } else {
    message = "Thank you for adding me to " + event.space.displayName;
  }

  if (event.message) {
    // Bot added through @mention.
    message = message + " and you said: \"" + event.message.text + "\"";
  }

  return { "text": message };
}

/**
 * Responds to a REMOVED_FROM_SPACE event in Hangouts Chat.
 *
 * @param {Object} event the event object from Hangouts Chat.
 */
function onRemoveFromSpace(event) {
  console.info("Bot removed from ", event.space.name);
}
