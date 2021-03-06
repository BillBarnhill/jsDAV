/*
 * @package jsDAV
 * @subpackage DAV
 * @copyright Copyright(c) 2011 Ajax.org B.V. <info AT ajax DOT org>
 * @author Mike de Boer <info AT mikedeboer DOT nl>
 * @license http://github.com/mikedeboer/jsDAV/blob/master/LICENSE MIT License
 */

var jsDAV             = require("./../../jsdav"),
    jsDAV_Ftp_Node    = require("./node").jsDAV_Ftp_Node,
    jsDAV_Ftp_File    = require("./file").jsDAV_Ftp_File,
    jsDAV_Directory   = require("./../directory").jsDAV_Directory,
    jsDAV_iCollection = require("./../iCollection").jsDAV_iCollection,
    jsDAV_iQuota      = require("./../iQuota").jsDAV_iQuota,

    Fs                = require("fs"),
    Async             = require("./../../../support/async.js"),
    Util              = require("../util"),
    Exc               = require("./../exceptions");

function jsDAV_Ftp_Directory(path, ftp) {
    this.path = (path || "").replace(/\s+[\/]+$/, "");
    this.ftp = ftp;
}

exports.jsDAV_Ftp_Directory = jsDAV_Ftp_Directory;

(function() {
    this.implement(jsDAV_Directory, jsDAV_iCollection, jsDAV_iQuota);
    
    /**
     * Creates a new file in the directory
     *
     * data is a readable stream resource
     *
     * @param string name Name of the file
     * @param resource data Initial payload
     * @return void
     */
    this.createFile = function(name, data, enc, cbftpcreatefile) {
        var newPath = (this.path + "/" + name).replace(/[\/]+$/, "");
        if (data.length === 0) { //ftp lib does not support writing empty files...
            data = new Buffer("empty file");
            enc  = "binary";
        }
        var self = this;
        var newFile = new jsDAV_Ftp_File(newPath, this.ftp);
        newFile.put(data, enc, function(err) {
            if(err)
                return cbftpcreatefile(err);
                
            cbftpcreatefile(null, newFile);
        });
    };

    /**
     * Creates a new subdirectory
     *
     * @param string name
     * @return void
     */
    this.createDirectory = function(name, cbftpcreatedir) {
        var newPath = this.path + "/" + name.replace(/[\/]+$/, "");
        var self = this;
        var mkdir = this.ftp.mkdir(newPath, function(err) {
            if (err)
                return cbftpcreatedir(err);
            
            var chmod = self.ftp.chmod(newPath, 755, function(err) {
                if (err)
                    return cbftpcreatedir(err);
                
                cbftpcreatedir(null, new jsDAV_Ftp_Directory(newPath, self.ftp));
            });
            if (!chmod)
                cbftpcreatedir(new Exc.jsDAV_Exception_NotImplemented("Could not create directory in "
                + newPath + ". User not authorized or command CHMOD not implemented."));
        });
        if (!mkdir)
            cbftpcreatedir(new Exc.jsDAV_Exception_NotImplemented("Could not create directory in "
            + newPath + ". User not authorized or command MKDIR not allowed."));
    };

    /**
     * Returns a specific child node, referenced by its name
     *
     * @param string name
     * @throws Sabre_DAV_Exception_FileNotFound
     * @return Sabre_DAV_INode
     */
    this.getChild = function(stat, cbftpgetchild) {
        if (typeof stat !== "object")
            return cbftpgetchild(new Exc.jsDAV_Exception_FileNotFound("Child node could not be retrieved"));
        
        var path = (this.path + "/" + stat.name).replace(/[\/]+$/, "");
        
        if (this.ftp.$cache[path])
            return cbftpgetchild(null, this.ftp.$cache[path]);
        
        if (stat.isDirectory())
            this.ftp.$cache[path] = new jsDAV_Ftp_Directory(path, this.ftp);
        else
            this.ftp.$cache[path] = new jsDAV_Ftp_File(path, this.ftp);
        
        this.ftp.$cache[path].$stat = stat;
        cbftpgetchild(null, this.ftp.$cache[path]);
    };

    /**
     * Returns an array with all the child nodes
     *
     * @return Sabre_DAV_INode[]
     */
    this.getChildren = function(cbftpgetchildren) {
        var nodes = [], self = this;
        
        this.ftp.readdir(this.path, function(err, listing) {
            if (err)
                return cbftpgetchildren(err);
            if (!listing)
                return cbftpgetchildren(null, nodes);
                
            Async.list(listing).each(function(node, next) {
                self.getChild(node, function(err, node) {
                    if (err)
                        return next();
                    
                    nodes.push(node);
                    next();
                });
            }).end(function() {
                cbftpgetchildren(null, nodes);
            });
        });
    };

    /**
     * Delete nodes in this directory recursively and finishes by deleting itself
     *
     * @return void
     */
    this["delete"] = function(cbftpdel) {
        var self = this;
        this.getChildren(function(err, children) {
            if (err)
                return cbftpdel(err);
            
            if (children.length) {
                Async.list(children).each(function(node, next) {
                    node["delete"](function(err){
                        if (err)
                            return cbftpdel(err);
                        next();
                    });
                }).end(function() {
                    self.realDelete(cbftpdel);
                });
            } else
                self.realDelete(cbftpdel);
        });
    };
    
    this.realDelete = function(cbftpdel) {
        var self = this;
        this.ftp.rmdir(this.path, function(err) {
            if (err)
                return cbftpdel(err);
                
            delete self.ftp.$cache[self.path];
            cbftpdel();
        });
    };

    /**
     * Returns available diskspace information
     *
     * @return array
     */
    this.getQuotaInfo = function(cbfsquota) {
        // @todo: impl. ftp.statvfs();
        return cbfsquota(null, [0, 0]);
    };
}).call(jsDAV_Ftp_Directory.prototype = new jsDAV_Ftp_Node());