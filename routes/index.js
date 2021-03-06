const express = require('express');

const router = express.Router();
const dynamoGuestFile = require('../controllers/dynamodb/dynamoGuestFile');
const generateCode = require('../controllers/generateCode');
const s3 = require('../controllers/s3');
const COGNITO = require('../controllers/cognito/cognito');

router.get('/', (req, res) => {
  let loginmessage = req.query.loginmessage;
  let signuperrormessage = req.query.signuperrormessage;
  let signupmessage = req.query.signupmessage;
  if (loginmessage) {
    res.render('index', {loginmessage: loginmessage});
  } else if (signuperrormessage === "Email này đã được đăng kí") {
    res.render('index', {signuperrormessage: signuperrormessage});
  } else if (signupmessage) {
    console.log(signupmessage);
    res.render('index', {signupmessage: signupmessage});
  } else {
    res.render('index');
  }
});

// Xử lý upload
router.post('/upload', (req, res) => {
  // Schema data file để thêm vào dynamo
  const fileUpload = {
    code: '',
    fileName: '',
    fileSize: 0,
    fileType: '',
    pass: '',
  };

  // Tạo code ngẫu nhiên 6 chữ số hoa thường
  generateCode.generate(6)
    .then((code) => {
      // Thành công sẽ thêm code attribute vào schema
      fileUpload.code = code;
      // console.log(code);
    })
    .catch(() => {
      res.status(500).json({err: 'Hệ thống không thể generate code'});
    });

  // Upload file lên s3
  s3.upload(req,20000000)
    .then((file) => {
      // Upload thành công sẽ trả về thông tin file, truyền thông tin vào schema
      fileUpload.fileName = file.fileName;
      fileUpload.fileSize = file.fileSize;
      fileUpload.fileType = file.fileType;
      fileUpload.pass = file.pass;
      // Sau khi schema đã thêm đầy đủ, create object ở dynamodb
      dynamoGuestFile.createFile(fileUpload)
        .then((item) => {
          // Thêm thành công sẽ trả về code tìm file
          // console.log("Lưu dynamo run"+JSON.stringify(item));
          res.status(200).json({code: `Code tìm kiếm: ${item.code}`});
        })
        .catch(() => {
          // Thêm thất bại trả về error
          res.status(500).json({err: 'Không thể thêm file vào database'});
        });
    })
    .catch((err) => {
      // Bắt lỗi file rỗng ở đây
      if (err.err === "File lớn hơn mức quy định là 20 MB") {
        res.status(411).json({err: err.err+", vui lòng đăng nhập để tăng dung lượng giới hạn lên 50MB"});
      }
      res.status(411).json({err: err.err});
    });
});

// Tìm file trong dynamodb và hiển thị thông tin trước khi download
router.post('/find', (req, res) => {
  // Tìm file
  if (req.body.code === undefined || req.body.code === "") {
    res.status(401).json({err: "Vui lòng nhập mã tìm kiếm"});
  } else {
    dynamoGuestFile.getFile(String(req.body.code))
      .then((data) => {
        // Check password
        if (String(req.body.pass) === String(data.Item.pass)) {
          res.status(200).json({data: data.Item});
        } else {
          res.status(401).json({err: 'Sai mật khẩu'});
        }
      })
      .catch((err) => {
        // Lỗi get file dynamo
        res.status(404).json({err: 'Không tìm thấy file'});
      });
  }
});

// Tải file về
router.get('/download/:filename', (req, res) => {
  console.log(req.params.filename);
  s3.download(req.params.filename, res);
});

router.post('/forgetpass', (req, res) => {
  COGNITO.forgotPassword(req.body.email)
    .then(data => {
      res.json({email: req.body.email});
    })
    .catch(err => {
      if (err.code === "UserNotFoundException") {
        res.status(404).json({message: "Email không tồn tại"});
      } else if (err.code === "InvalidParameterException") {
        res.status(403).json({message: "Email chưa xác nhận không thể gửi yêu cầu quên mật khẩu"});
      } else {
        res.status(429).json({message: "Giới hạn yêu cầu reset, vui lòng thử lại sau"})
      }
    });
});

router.post('/confirmpass', (req, res) => {
  console.log(req.body);
  COGNITO.confirmPassword(req.body.email, req.body.code, req.body.pass)
    .then(data => {
      res.status(200).json({message: "Đổi mật khẩu thành công"});
    })
    .catch(err => {
      console.log(JSON.stringify(err));
      res.status(400).json({message: "Code xác nhận không chính xác vui lòng thử lại"});
    });
});

let admin = 'admin';
let pass = 'Sudo123';
let adminSesion = false;

router.get('/admin', (req, res) => {
  if (adminSesion === true) {
    let users = [];
    COGNITO.getAll()
      .then((data) => {
        users = data;
        res.render('admin/_adminMange',{users: users});
      });
  } else {
    res.render('admin/index');
  }
});

router.post('/admin', (req, res) => {
  if (req.body.admin === admin && req.body.password === pass) {
    adminSesion = true;
    let users = [];
    COGNITO.getAll()
      .then((data) => {
        users = data;
        res.render('admin/_adminMange',{users: users});
      });
  } else {
    res.render('admin/index',{adminmessage: "Sai tài khoản hoặc mật khẩu"});
  }
});

router.get('/admin/signout', (req, res) => {
  adminSesion = false;
  res.redirect('/admin');
});

router.get('/admin/disable', (req, res) => {
  COGNITO.disableUser(req.query.username)
    .then(() => {
      res.redirect('/admin')
    })
    .catch(() => {
      res.redirect('/admin')
    });
});

router.get('/admin/enable', (req, res) => {
  COGNITO.enableUser(req.query.username)
    .then(() => {
      res.redirect('/admin')
    })
    .catch(() => {
      res.redirect('/admin')
    });
});

module.exports = router;
  